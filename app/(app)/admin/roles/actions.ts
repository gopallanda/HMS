'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { roleDeleteSchema, roleSchema, systemRoleSchema } from '@/lib/schemas/role';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Roles.
 *
 * A role is data, not a deployment. An administrator creating "Ward sister"
 * and ticking four boxes has to take effect on that person's next sign-in with
 * nobody shipping anything -- that is the difference between a hospital that
 * can describe itself in the software and one that cannot.
 *
 * Every action here checks roles.manage FIRST and from the session. The role
 * editor is the screen where a permission mistake is most expensive, because
 * the thing being edited is the permission system.
 */

function permissionsFrom(formData: FormData): string[] {
  return formData.getAll('permissions').map((value) => value.toString());
}

export async function saveRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('roles.manage');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const isSystem = formData.get('is_system') === 'true';
  const supabase = await createClient();

  // A system role's code is fixed: seed_system_roles finds these by code, and
  // so will the landing map. Its name, description and permissions are the
  // hospital's business -- a hospital that calls its receptionists "OPD desk"
  // should be able to say so.
  if (isSystem) {
    const parsed = systemRoleSchema.safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
      description: formData.get('description'),
      can_login: formData.get('can_login'),
      permissions: permissionsFrom(formData),
    });
    if (!parsed.success) return invalid(parsed.error);

    const { error } = await supabase
      .from('roles')
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        can_login: parsed.data.can_login,
      })
      .eq('id', parsed.data.id)
      .eq('hospital_id', session.hospitalId)
      .is('deleted_at', null);

    if (error) return failure(describeDatabaseError(error));

    const applied = await applyPermissions(supabase, parsed.data.id, parsed.data.permissions);
    if (applied) return failure(applied);

    refresh();
    return success(`${parsed.data.name} saved.`);
  }

  const parsed = roleSchema.safeParse({
    id: formData.get('id'),
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description'),
    can_login: formData.get('can_login'),
    permissions: permissionsFrom(formData),
  });
  if (!parsed.success) return invalid(parsed.error);

  // Upsert on the client-generated id (CLAUDE.md 7): a form resubmitted after a
  // dropped connection writes the same row rather than a second role.
  const { error } = await supabase.from('roles').upsert(
    {
      id: parsed.data.id,
      hospital_id: session.hospitalId,
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description,
      can_login: parsed.data.can_login,
      is_system: false,
      // Custom roles are for access, not for minting doctors: legacy_role stays
      // at its inert default, so a custom role never lands in a doctor list.
      // Block 4 gives that its own flag.
    },
    { onConflict: 'id' },
  );

  if (error) {
    if (`${error.message} ${error.details ?? ''}`.includes('roles_hospital_id_lower_code_key')) {
      return failure('Another role already uses that code.', {
        code: ['That code is taken.'],
      });
    }
    return failure(describeDatabaseError(error));
  }

  const applied = await applyPermissions(supabase, parsed.data.id, parsed.data.permissions);
  if (applied) return failure(applied);

  refresh();
  return success(`${parsed.data.name} saved.`);
}

/**
 * The permission list goes through set_role_permissions() rather than a delete
 * and an insert from here. Two round trips would leave a role holding nothing
 * if the second failed, and a role holding nothing is a person who cannot work
 * (CLAUDE.md 3.2 is about money, but the reasoning is the same: a change that
 * is only half applied is worse than one that did not happen).
 */
async function applyPermissions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleId: string,
  keys: string[],
): Promise<string | null> {
  const { error } = await supabase.rpc('set_role_permissions', {
    p_role_id: roleId,
    p_keys: keys,
  });

  if (!error) return null;
  return `The role was saved but its permissions were not: ${describeDatabaseError(error)}`;
}

/**
 * Retiring a custom role.
 *
 * Soft, like everything else in this schema (CLAUDE.md 3.5). Refused outright
 * while anybody still holds it -- reassigning forty people is a decision, and
 * doing it silently on their behalf is how somebody ends up with permissions
 * nobody chose for them. System roles are never deletable.
 */
export async function deleteRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('roles.manage');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const parsed = roleDeleteSchema.safeParse({
    id: formData.get('id'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: role, error: readError } = await supabase
    .from('roles')
    .select('id, name, is_system')
    .eq('id', parsed.data.id)
    .eq('hospital_id', session.hospitalId)
    .is('deleted_at', null)
    .maybeSingle();

  if (readError) return failure(describeDatabaseError(readError));
  if (!role) return failure('That role no longer exists.');
  if (role.is_system) {
    return failure(`${role.name} is a built-in role and cannot be deleted. Rename it instead.`);
  }

  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (normalise(parsed.data.confirm) !== normalise(role.name)) {
    return failure(`Type ${role.name} to confirm.`, {
      confirm: ['That does not match the name of the role.'],
    });
  }

  const { count } = await supabase
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('hospital_id', session.hospitalId)
    .eq('role_id', role.id);

  if ((count ?? 0) > 0) {
    return failure(
      `${count} staff member${count === 1 ? '' : 's'} still hold${count === 1 ? 's' : ''} ` +
        `${role.name}. Move them to another role first.`,
    );
  }

  const { error } = await supabase
    .from('roles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', role.id)
    .eq('hospital_id', session.hospitalId);

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${role.name} deleted.`);
}

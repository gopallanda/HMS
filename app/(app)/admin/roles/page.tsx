import { RolesTable, type RoleRow } from './roles-table';
import { AccessDenied } from '@/components/shell/access-denied';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Roles' };

/**
 * Roles.
 *
 * The screen that ends the confusion this phase exists to fix: a DEPARTMENT is
 * where somebody sits, a ROLE is what they may open, and one is never derived
 * from the other. The page says so out loud, because the build that came
 * before this one had departments standing in for both.
 */
export default async function RolesPage() {
  const session = await requireSession();

  if (!session.access.permissions.has('roles.manage')) {
    return <AccessDenied roleName={roleDisplayName(session)} area="Roles" />;
  }

  const supabase = await createClient();

  const [roleResult, permissionResult, staffResult] = await Promise.all([
    supabase
      .from('roles')
      .select('id, code, name, description, is_system, can_login')
      .eq('hospital_id', session.hospitalId)
      .is('deleted_at', null)
      .order('is_system', { ascending: false })
      .order('name'),
    supabase
      .from('role_permissions')
      .select('role_id, permission_key')
      .eq('hospital_id', session.hospitalId),
    supabase
      .from('staff')
      .select('role_id')
      .eq('hospital_id', session.hospitalId)
      .eq('is_active', true),
  ]);

  const failed = roleResult.error ?? permissionResult.error ?? staffResult.error;
  if (failed) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Roles" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          Roles could not be loaded: {failed.message}
        </p>
      </div>
    );
  }

  const held = new Map<string, string[]>();
  for (const row of permissionResult.data ?? []) {
    held.set(row.role_id, [...(held.get(row.role_id) ?? []), row.permission_key]);
  }

  const headcount = new Map<string, number>();
  for (const row of staffResult.data ?? []) {
    headcount.set(row.role_id, (headcount.get(row.role_id) ?? 0) + 1);
  }

  const roles: RoleRow[] = (roleResult.data ?? []).map((role) => ({
    ...role,
    permissions: held.get(role.id) ?? [],
    staff_count: headcount.get(role.id) ?? 0,
  }));

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Roles"
        description="What a person does, and therefore what they may open. A role is not a department -- a nurse in Cardiology and a nurse in Housekeeping hold the same role."
      />
      <RolesTable roles={roles} />
    </div>
  );
}

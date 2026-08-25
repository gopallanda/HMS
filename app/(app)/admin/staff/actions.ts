'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { requireSessionForAction } from '@/lib/auth/session';
import { attachStaffLogin } from '@/lib/rpc/onboarding';
import { isAdminRole } from '@/lib/roles';
import { staffInviteSchema, staffSchema } from '@/lib/schemas/staff';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Create or update a staff record.
 *
 * Note what this does NOT do: it never touches memberships. A staff row is the
 * hospital's record of a person; a membership is that person's login and the
 * role their JWT carries. Editing someone's staff role here does not silently
 * hand them admin rights in the database -- that is a separate, deliberate act
 * (CLAUDE.md 5).
 */
export async function saveStaff(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionForAction();
  if (!isAdminRole(session.role)) {
    return failure('Only an administrator can change staff records.');
  }

  const parsed = staffSchema.safeParse({
    id: formData.get('id'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
    department_id: formData.get('department_id'),
    phone: formData.get('phone'),
    reg_no: formData.get('reg_no'),
    consultation_fee: formData.get('consultation_fee'),
    is_active: formData.get('is_active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { error } = await supabase.from('staff').upsert(
    {
      id: parsed.data.id,
      hospital_id: session.hospitalId,
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      department_id: parsed.data.department_id,
      phone: parsed.data.phone,
      reg_no: parsed.data.reg_no,
      consultation_fee: parsed.data.consultation_fee,
      is_active: parsed.data.is_active,
    },
    { onConflict: 'id' },
  );

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${parsed.data.full_name} saved.`);
}

const activationSchema = z.object({
  id: z.uuid('Invalid staff record.'),
  confirm: z.string().trim(),
});

/**
 * Deactivate or reactivate a staff record. Never a delete: consultation notes,
 * charges and payments in Phase 1 all point back at a staff row (CLAUDE.md 3.5).
 */
export async function setStaffActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionForAction();
  if (!isAdminRole(session.role)) {
    return failure('Only an administrator can change staff records.');
  }

  const parsed = activationSchema.safeParse({
    id: formData.get('id'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const activate = formData.get('is_active') === 'true';

  const supabase = await createClient();

  const { data: staff, error: readError } = await supabase
    .from('staff')
    .select('full_name')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (readError) return failure(describeDatabaseError(readError));
  if (!staff) return failure('That staff record no longer exists.');

  // Same reasoning as departments: the schema has no reason column, so the
  // typed name is what makes the action deliberate.
  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!activate && normalise(parsed.data.confirm) !== normalise(staff.full_name)) {
    return failure(`Type ${staff.full_name} to confirm.`, {
      confirm: ['That does not match the name on the record.'],
    });
  }

  const { error } = await supabase
    .from('staff')
    .update({ is_active: activate })
    .eq('id', parsed.data.id);

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${staff.full_name} ${activate ? 'reactivated' : 'deactivated'}.`);
}

/**
 * Issue a login to an existing staff record.
 *
 * Three steps, and the order is what makes it safe:
 *
 *   1. attach_staff_login. If that email already has an account -- they work at
 *      another hospital, or were invited here before and deactivated -- this
 *      finishes the job outright and no email is sent.
 *   2. Only if it reports 'no_such_user': create the account and send the
 *      invitation, through the service-role admin API. This is the one step
 *      that genuinely needs the service role, and it is the only thing it does.
 *   3. attach_staff_login again, now that the account exists.
 *
 * Doing it this way means the RPC is never trusted with account creation and
 * the service-role client never touches memberships or staff -- those writes
 * stay behind the tenant and role checks inside the function.
 */
export async function inviteStaff(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionForAction();
  if (!isAdminRole(session.role)) {
    return failure('Only an administrator can issue a login.');
  }

  const parsed = staffInviteSchema.safeParse({
    staff_id: formData.get('staff_id'),
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const args = {
    p_staff_id: parsed.data.staff_id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  };

  const first = await attachStaffLogin(supabase, args);
  if (first.error) return failure(describeDatabaseError(first.error));

  if (first.data?.status === 'attached') {
    refresh();
    return success(
      `${parsed.data.email} already had an account and can now sign in to this hospital. No invitation was sent.`,
    );
  }

  // Step 2. Note what is NOT passed as user metadata: no hospital_name. That
  // key is what provision_hospital acts on, and an invited member must never
  // get a hospital of their own -- they are joining this one.
  const admin = createAdminClient();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: formData.get('full_name')?.toString() ?? '' },
  });

  if (inviteError) {
    return failure(`The invitation could not be sent: ${inviteError.message}`);
  }

  const second = await attachStaffLogin(supabase, args);
  if (second.error) {
    // The account exists now but is attached to nothing. Say so plainly rather
    // than reporting success -- the fix is to invite the same address again,
    // which step 1 will complete without sending a second email.
    return failure(
      `${parsed.data.email} was invited, but could not be linked to this staff record: ` +
        `${describeDatabaseError(second.error)} Invite the same address again to finish.`,
    );
  }

  if (second.data?.status !== 'attached') {
    return failure(
      `${parsed.data.email} was invited, but the account could not be found afterwards. ` +
        'Invite the same address again to finish.',
    );
  }

  refresh();
  return success(`Invitation sent to ${parsed.data.email}.`);
}

'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { requireSessionForAction } from '@/lib/auth/session';
import { isAdminRole } from '@/lib/roles';
import { staffSchema } from '@/lib/schemas/staff';
import { describeDatabaseError } from '@/lib/supabase/errors';
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

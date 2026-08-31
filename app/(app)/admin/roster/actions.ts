'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { shiftClearSchema, shiftSchema } from '@/lib/schemas/shift';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * The roster.
 *
 * This is the page a cleaner exists on. They have no login, no queue and no
 * invoices; what they have is a month of days, each one worked, off or absent,
 * and a manager who has to be able to record which. Before block 1 there was
 * nowhere in this product for that to live.
 *
 * hours is written, not derived at read time. The database computes it from
 * the two times when they are both given and the field is left empty
 * (20260828090100), but a manager who types 7.5 for a shift that ran 08:00 to
 * 16:00 with an unpaid break is telling the truth about payroll and the
 * formula is not.
 */

export async function saveShift(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('roster.write');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const parsed = shiftSchema.safeParse({
    id: formData.get('id'),
    staff_id: formData.get('staff_id'),
    work_date: formData.get('work_date'),
    status: formData.get('status'),
    start_time: formData.get('start_time'),
    end_time: formData.get('end_time'),
    hours: formData.get('hours'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  // One row per person per day (the unique constraint says so), so this is an
  // upsert on that pair rather than on the client-generated id: two managers
  // filling the same cell should end with one answer, not a constraint error.
  const { error } = await supabase.from('staff_shifts').upsert(
    {
      id: parsed.data.id,
      hospital_id: session.hospitalId,
      staff_id: parsed.data.staff_id,
      work_date: parsed.data.work_date,
      status: parsed.data.status,
      start_time: parsed.data.start_time,
      end_time: parsed.data.end_time,
      hours: parsed.data.hours,
      notes: parsed.data.notes,
      created_by: session.userId,
    },
    { onConflict: 'hospital_id,staff_id,work_date' },
  );

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success('Shift saved.');
}

/**
 * Clearing a cell.
 *
 * The one genuine delete in this schema, and it is defensible: an empty cell
 * means "nothing recorded", which is a different statement from "day off", and
 * without this there would be no way back to it after a mis-click. The audit
 * trigger records the deletion, so the history is not lost.
 */
export async function clearShift(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('roster.write');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const parsed = shiftClearSchema.safeParse({
    staff_id: formData.get('staff_id'),
    work_date: formData.get('work_date'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { error } = await supabase
    .from('staff_shifts')
    .delete()
    .eq('hospital_id', session.hospitalId)
    .eq('staff_id', parsed.data.staff_id)
    .eq('work_date', parsed.data.work_date);

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success('Shift cleared.');
}

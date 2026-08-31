'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { transferSchema } from '@/lib/schemas/transfer';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Transfer a visit to another doctor (block 7.1).
 *
 * The one way a visit's doctor changes after registration. It is not an edit
 * on a field: the patient moves to the back of the new doctor's queue with a
 * new token, the old token is retired rather than reused, and the reason is
 * recorded -- all inside transfer_visit(), in one transaction.
 *
 * queue.manage rather than visits.create. Moving somebody who is already
 * waiting is a queue decision, and a hospital that lets a nurse run the queue
 * without letting her register patients should get exactly that.
 */
export async function transferVisitAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('queue.manage');
  if (!gate.ok) return failure(gate.message);

  const parsed = transferSchema.safeParse({
    visit_id: formData.get('visit_id'),
    doctor_id: formData.get('doctor_id'),
    department_id: formData.get('department_id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('transfer_visit', {
    p_visit_id: parsed.data.visit_id,
    p_doctor_id: parsed.data.doctor_id,
    p_reason: parsed.data.reason,
    p_department_id: parsed.data.department_id,
  });

  if (error) return failure(describeDatabaseError(error));
  if (!data) return failure('The visit could not be moved. Try again.');

  refresh();

  return success(`Now token ${data.token_no} for ${data.doctor_name}.`);
}

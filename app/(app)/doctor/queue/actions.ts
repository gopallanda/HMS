'use server';

import { refresh } from 'next/cache';

import { failure, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { setVisitStatus, type QueueStatus } from '@/lib/rpc/visits';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Move a patient through the queue from the queue itself.
 *
 * WHY THIS IS NOT saveConsultationAction
 *
 * A doctor in an Indian OPD sees thirty to sixty patients in a morning and
 * writes a note on a minority of them. Until this action existed the only way
 * a visit could leave the board was through the consultation form, so in
 * practice visits never left it: tokens did not rotate, "seen today" stayed at
 * zero, and the waiting count the register desk prints next to each doctor was
 * wrong from about ten o'clock onwards. The front desk then has to ask the
 * doctor out loud who is next, which is the exact phone call the software was
 * bought to stop.
 *
 * It cannot be routed through save_consultation either, because that function
 * REPLACES the vitals in its payload rather than merging them -- a queue
 * button with no vitals on it would blank the readings the nurse took. So the
 * two acts stay two functions: set_visit_status touches the visit and nothing
 * else.
 *
 * consultation.write rather than a new permission key: deciding a patient has
 * been seen is the same authority as writing down what happened to them, and a
 * hospital that hands one out without the other has not said anything
 * different (CLAUDE.md 3.6 -- the key union is frozen in code, so a new key is
 * a deploy and this one is not needed).
 *
 * The database still decides WHOSE queue this is. current_staff_id() inside
 * the RPC refuses a doctor moving another doctor's patient, the same rule and
 * the same sentence as save_consultation, so there is one answer to that
 * question rather than two that can drift.
 */
export async function setVisitStatusAction(
  visitId: string,
  status: QueueStatus,
): Promise<ActionState> {
  const gate = await checkPermission('consultation.write');
  if (!gate.ok) return failure(gate.message);

  const supabase = await createClient();
  const { data, error } = await setVisitStatus(supabase, visitId, status);

  if (error) return failure(describeDatabaseError(error));
  if (!data) return failure('The queue could not be updated. Try again.');

  // The board is a Server Component. This makes it current in this tab; the
  // front desk and every other doctor find out through Realtime on visits.
  refresh();

  return success(MESSAGE[status](data.token_no));
}

const MESSAGE: Record<QueueStatus, (token: number) => string> = {
  waiting: (token) => `Token ${token} is back in the queue.`,
  in_consultation: (token) => `Token ${token} is with you.`,
  completed: (token) => `Token ${token} completed.`,
};

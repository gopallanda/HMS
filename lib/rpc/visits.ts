/**
 * Typed wrappers around the visit-queue Postgres functions.
 *
 * They are here rather than folded into the consultation wrapper on purpose: moving a patient through the queue and writing what
 * happened to them are different acts with different failure modes, and
 * save_consultation REPLACES the vitals it is given. A queue button routed
 * through that function would wipe a nurse's readings every time a doctor
 * pressed "Complete" without opening the form.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, VisitStatus } from '@/types/database';

type Client = SupabaseClient<Database>;

export type VisitStatusResult =
  Database['public']['Functions']['set_visit_status']['Returns'];

export type CancelVisitResult =
  Database['public']['Functions']['cancel_visit']['Returns'];

/** waiting | in_consultation | completed. Cancellation is a front-desk act. */
export type QueueStatus = Extract<VisitStatus, 'waiting' | 'in_consultation' | 'completed'>;

export async function setVisitStatus(
  supabase: Client,
  visitId: string,
  status: QueueStatus,
) {
  // p_hospital_id is deliberately absent: the function reads the tenant from
  // the JWT and refuses an argument that disagrees (CLAUDE.md 3.1).
  return supabase.rpc('set_visit_status', { p_visit_id: visitId, p_status: status });
}

/**
 * What happens to money already collected on a visit being cancelled
 * (20260923090000). Only consulted when there is some.
 *
 *   retain  The hospital keeps it. The paid invoice is left exactly as it is,
 *           because it is a true record of money that is still in the drawer.
 *           No money moves, so this needs no billing permission -- it is the
 *           front desk's path and the ordinary walk-out.
 *   refund  It goes back over the counter: the invoice is voided and the
 *           payment reversed. Gated on billing.void in the action.
 */
export type CancelMoney = 'retain' | 'refund';

/**
 * Cancel a visit, with a typed reason.
 *
 * Not a status transition through setVisitStatus: cancel_visit also decides
 * what happens to the money -- void what was never paid, keep or refund what
 * was -- and set_visit_status deliberately cannot reach `cancelled` for
 * exactly that reason.
 *
 * `money` is passed on every call rather than only when the caller believes
 * there is something to settle. Whether a payment exists is a question about
 * the database at the moment of the write, not about what the screen was
 * showing when it rendered, and cancel_visit ignores the argument when nothing
 * has been collected.
 *
 * p_hospital_id is absent for the usual reason: the function reads the tenant
 * from the JWT and refuses an argument that disagrees (CLAUDE.md 3.1).
 */
export async function cancelVisit(
  supabase: Client,
  visitId: string,
  reason: string,
  money: CancelMoney,
) {
  return supabase.rpc('cancel_visit', {
    p_visit_id: visitId,
    p_reason: reason,
    p_money: money,
  });
}

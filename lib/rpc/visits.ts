/**
 * Typed wrappers around the visit-queue Postgres functions.
 *
 * One function, and it is here rather than folded into the consultation
 * wrapper on purpose: moving a patient through the queue and writing what
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

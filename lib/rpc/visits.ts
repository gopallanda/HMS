/**
 * Typed wrapper around create_visit.
 *
 * One call allocates the visit number, takes the next queue token for the day
 * and raises the consultation charge from the doctor's fee -- all in a single
 * transaction, because a visit that exists without its charge is a visit
 * somebody is seen for and never billed for (CLAUDE.md 3.2, 4).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';

type Client = SupabaseClient<Database>;

export type VisitRow = Database['public']['Tables']['visits']['Row'];
export type QueueRow = Database['public']['Views']['visit_queue']['Row'];

export type CreateVisitPayload = {
  /** Client-generated, so a resubmitted form returns the same visit. */
  id: string;
  patient_id: string;
  doctor_id: string | null;
  department_id: string | null;
  visit_type: Database['public']['Enums']['visit_type'];
  /** Default true. False registers the visit without raising a charge. */
  seed_consultation?: boolean;
};

export async function createVisit(supabase: Client, payload: CreateVisitPayload) {
  return supabase.rpc('create_visit', { payload: payload as unknown as Json });
}

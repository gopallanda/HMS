/**
 * Typed wrappers around the patient Postgres functions.
 *
 * These take the Supabase client as an argument rather than creating one, so
 * the same wrapper serves a Server Action (RLS as the signed-in user) and the
 * browser client behind the search box. Nothing here decides which client is
 * appropriate; the call site does.
 *
 * No wrapper writes a table directly -- that is the whole point of the
 * directory (CLAUDE.md 6, 3.2).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';

type Client = SupabaseClient<Database>;

export type PatientRow = Database['public']['Tables']['patients']['Row'];
export type PatientSearchResult =
  Database['public']['Functions']['search_patients']['Returns'][number];

/**
 * register_patient raises this when the phone is already on file and
 * force_create was not set. It is a question for the desk, not a failure:
 * families share a mobile, so the caller shows the matches and lets a human
 * decide (see supabase/migrations/20260818120100_patient_visit_rpcs.sql).
 */
export const DUPLICATE_PHONE = '90001';

/** Search-first registration (CLAUDE.md 3.3). Read-only; RLS applies. */
export async function searchPatients(supabase: Client, query: string, limit = 8) {
  return supabase.rpc('search_patients', { p_query: query, p_limit: limit });
}

export type RegisterPatientPayload = {
  /** Client-generated, so a resubmitted form returns the same patient. */
  id: string;
  full_name: string;
  dob: string;
  gender: Database['public']['Enums']['gender'];
  phone: string | null;
  address: string | null;
  force_create?: boolean;
};

/** Allocates the MRN and writes the row, in one transaction. */
export async function registerPatient(supabase: Client, payload: RegisterPatientPayload) {
  return supabase.rpc('register_patient', { payload: payload as unknown as Json });
}

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

import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

export type PatientSearchResult =
  Database['public']['Functions']['search_patients']['Returns'][number];

/**
 * register_patient's duplicate-phone check (error 90001) has NO wrapper here,
 * on purpose.
 *
 * It was defect 4: a phone number identifies a household, not a person, and an
 * Indian family sharing one mobile is the norm. register_patient_visit sets
 * force_create unconditionally, so the desk never meets that error. What
 * prevents a duplicate MRN is the matches panel on the register screen, which
 * informs and never blocks (block 4.1).
 *
 * The check survives in SQL for a direct caller that wants it. Nothing in this
 * application is one.
 */

/** Search-first registration (CLAUDE.md 3.3). Read-only; RLS applies. */
export async function searchPatients(supabase: Client, query: string, limit = 8) {
  return supabase.rpc('search_patients', { p_query: query, p_limit: limit });
}

/**
 * What the patients screen shows before anybody types.
 *
 * Same row shape as searchPatients, deliberately, so one component renders
 * both and the operator's eye finds the MRN in the same column either way.
 *
 * It exists because search-first was being read as empty-first: a clerk who
 * had just registered somebody opened the patients module, saw a blank panel
 * and concluded the registration had not saved. The recent list answers that
 * without turning the screen into a paginated list of every patient in the
 * hospital, which is the thing search-first is avoiding.
 */
export async function recentPatients(supabase: Client, limit = 12) {
  return supabase.rpc('recent_patients', { p_limit: limit });
}

/**
 * Registering a patient is no longer a call of its own: it happens inside
 * register_patient_visit, with the visit, the token and the money, in one
 * transaction (lib/rpc/registration.ts, block 4). A standalone wrapper here
 * would be a second way to create a patient -- one that produces exactly the
 * half-finished state this phase existed to remove.
 */

/**
 * Typed wrapper around save_consultation.
 *
 * One call writes the vitals, the notes and the visit's new status inside a
 * single transaction. Splitting it into "save the note" and "mark it done"
 * would let the first succeed and the second fail, leaving a completed
 * consultation on a patient the queue still shows as waiting -- and nobody
 * would notice until the queue was read at the end of the day.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PrescriptionLine, Vitals } from '@/lib/consultations';
import type { Database, Json } from '@/types/database';

type Client = SupabaseClient<Database>;

export type ConsultationRow = Database['public']['Tables']['consultations']['Row'];

export type SaveConsultationPayload = Vitals & {
  /** Client-generated, so a resubmitted form writes one row (CLAUDE.md 7). */
  id: string;
  visit_id: string;
  notes: string | null;
  /** null leaves the visit's status alone. */
  visit_status: 'in_consultation' | 'completed' | null;
  /**
   * The whole prescription, or the key omitted entirely.
   *
   * save_consultation tells those two apart on purpose: absent means "leave
   * what is there", an array means "this is the list now, including empty". A
   * caller that does not know about prescriptions must not erase one.
   */
  prescription?: PrescriptionLine[];
};

export async function saveConsultation(supabase: Client, payload: SaveConsultationPayload) {
  return supabase.rpc('save_consultation', { payload: payload as unknown as Json });
}

'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { saveConsultation } from '@/lib/rpc/consultations';
import { consultationSchema } from '@/lib/schemas/consultation';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export type SaveConsultationState = ActionState & {
  /** The visit left the queue, so the screen can offer the way back to it. */
  completed?: boolean;
};

/**
 * Write the consultation.
 *
 * The vitals, the notes and the visit's new status all move in one
 * transaction inside save_consultation. This action validates early so the
 * doctor sees a mistake before the round trip, checks the role because a
 * Server Action answers a POST without passing through any layout, and then
 * gets out of the way.
 *
 * It deliberately does NOT check whose patient this is: that rule needs the
 * visit, and the visit is read inside the RPC. Duplicating it here would mean
 * two answers to one question, and the one in Postgres is the one that holds.
 */
export async function saveConsultationAction(
  _previous: SaveConsultationState,
  formData: FormData,
): Promise<SaveConsultationState> {
  const gate = await checkPermission('consultation.write');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = consultationSchema.safeParse({
    id: formData.get('id'),
    visit_id: formData.get('visit_id'),
    bp_systolic: formData.get('bp_systolic'),
    bp_diastolic: formData.get('bp_diastolic'),
    pulse: formData.get('pulse'),
    temperature_f: formData.get('temperature_f'),
    weight_kg: formData.get('weight_kg'),
    spo2: formData.get('spo2'),
    notes: formData.get('notes'),
    visit_status: formData.get('visit_status'),
    prescription: formData.get('prescription') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  // prescription.create is checked separately, and only when a script is
  // actually being written: a doctor who may record notes but not prescribe
  // still saves vitals. The <Can> around the editor is decoration; this is the
  // gate (CLAUDE.md 3.6).
  if (parsed.data.prescription.length > 0) {
    const scriptGate = await checkPermission('prescription.create');
    if (!scriptGate.ok) return failure(scriptGate.message);
  }

  const supabase = await createClient();
  const { error } = await saveConsultation(supabase, parsed.data);

  if (error) return failure(describeDatabaseError(error));

  // The queue behind this screen, the status badge above the form and the
  // "notes started" marker are all rendered on the server.
  refresh();

  const completed = parsed.data.visit_status === 'completed';

  return {
    ...success(completed ? 'Visit completed and removed from your queue.' : 'Consultation saved.'),
    completed,
  };
}

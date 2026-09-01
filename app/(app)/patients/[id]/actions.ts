'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { reportActionError } from '@/lib/report-error';
import { patientEditSchema } from '@/lib/schemas/patient';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Correcting a patient record.
 *
 * A plain UPDATE rather than an RPC, and that is not an oversight: patients
 * carries no money and no numbering, patients_update_desk already restricts the
 * write to the desk roles, and the audit trigger records the before and after
 * (CLAUDE.md 3.5). The RPC rule exists for invoices, payments and charge_items
 * (CLAUDE.md 3.2), and none of them are touched here.
 *
 * What this deliberately cannot change: the MRN (allocated by next_number and
 * printed on documents), the hospital, and any invoice already raised --
 * invoices carry patient_name_snapshot precisely so that correcting a spelling
 * today does not rewrite a bill somebody was handed last month (CLAUDE.md 4).
 */
export async function updatePatient(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('patients.update');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = patientEditSchema.safeParse({
    id: formData.get('id'),
    full_name: formData.get('full_name'),
    dob: formData.get('dob'),
    age_years: formData.get('age_years'),
    gender: formData.get('gender'),
    phone: formData.get('phone'),
    address: formData.get('address'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  // Read first, for two reasons: a removed record must not be edited behind
  // the banner that says it is removed, and PostgREST reports an update that
  // matched nothing as a success with no rows -- which would leave the desk
  // believing a correction was saved.
  const { data: existing, error: readError } = await supabase
    .from('patients')
    .select('id, mrn, deleted_at')
    .eq('hospital_id', session.hospitalId)
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (readError) {
    await reportActionError('updatePatient', readError);
    return failure(describeDatabaseError(readError));
  }
  if (!existing) return failure('That patient record no longer exists.');
  if (existing.deleted_at !== null) {
    return failure('That record has been removed. Restore it before correcting it.');
  }

  const { error } = await supabase
    .from('patients')
    .update({
      full_name: parsed.data.full_name,
      dob: parsed.data.dob,
      gender: parsed.data.gender,
      phone: parsed.data.phone,
      address: parsed.data.address,
    })
    .eq('hospital_id', session.hospitalId)
    .eq('id', parsed.data.id);

  if (error) {
    await reportActionError('updatePatient', error);
    return failure(describeDatabaseError(error));
  }

  refresh();
  return success(`${parsed.data.full_name} saved. Invoices already raised keep the old name.`);
}

const removalSchema = z.object({
  id: z.uuid('Invalid patient.'),
  /** The patient's MRN, retyped. Compared against the row on the server. */
  confirm: z.string().trim(),
});

/**
 * Remove a duplicate, or put one back.
 *
 * Soft delete only (CLAUDE.md 3.3): deleted_at, never a delete. The visits and
 * the invoices stay exactly where they are, and a link from an old bill still
 * opens the record -- with a banner saying what happened to it.
 *
 * The typed MRN is the stand-in for a reason field, the same arrangement the
 * departments screen uses: patients has no deleted_reason column, and adding a
 * column CLAUDE.md 4 does not list is not a decision to make in passing. What
 * it buys is deliberateness (CLAUDE.md 7).
 *
 * Admin only, deliberately narrower than patients_update_desk allows. Removing
 * the wrong twin at a busy counter is the mistake this is guarding against, and
 * the thing the desk actually wants -- merging a duplicate onto the real
 * record -- moves visits.patient_id and needs an RPC of its own. It is not
 * this.
 */
export async function setPatientRemoved(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('patients.update');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = removalSchema.safeParse({
    id: formData.get('id'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const restore = formData.get('removed') !== 'true';

  const supabase = await createClient();

  const { data: patient, error: readError } = await supabase
    .from('patients')
    .select('id, mrn, full_name, deleted_at')
    .eq('hospital_id', session.hospitalId)
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (readError) {
    await reportActionError('setPatientRemoved', readError);
    return failure(describeDatabaseError(readError));
  }
  if (!patient) return failure('That patient record no longer exists.');

  if (!restore && parsed.data.confirm.toUpperCase() !== patient.mrn.toUpperCase()) {
    return failure(`Type ${patient.mrn} to confirm.`, {
      confirm: [`Type ${patient.mrn} exactly.`],
    });
  }

  const { error } = await supabase
    .from('patients')
    .update({ deleted_at: restore ? null : new Date().toISOString() })
    .eq('hospital_id', session.hospitalId)
    .eq('id', parsed.data.id);

  if (error) {
    await reportActionError('setPatientRemoved', error);
    return failure(describeDatabaseError(error));
  }

  refresh();
  return success(
    restore
      ? `${patient.full_name} restored.`
      : `${patient.full_name} removed. Their visits and bills are untouched.`,
  );
}

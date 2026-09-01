'use server';

import { refresh } from 'next/cache';

import { checkPermission } from '@/lib/auth/session';
import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { registerPatientVisit, type RegistrationResult } from '@/lib/rpc/registration';
import { reportActionError } from '@/lib/report-error';
import { registrationSchema } from '@/lib/schemas/registration';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Registration. One action, one RPC, one transaction (block 4.2).
 *
 * What this replaces: registerPatientAction and startVisitAction, which were
 * two posts with a dialog between them. A clerk could complete the first and
 * abandon the second, and the result was a patient with no visit -- or, worse,
 * a visit with no doctor, no token and no money asked for, which is invisible
 * to every screen in the product. Making it one call is the fix; making the
 * form required fields was not, because the shape allowed the bad state.
 *
 * The DUPLICATE_PHONE branch is gone with them (defect 4). A phone number
 * identifies a household. The screen still shows who else is on the number --
 * as information, with a "use this patient" button, which is what actually
 * prevents a duplicate MRN -- and it never blocks.
 */

export type RegisterState = ActionState & { result?: RegistrationResult };

export async function registerAction(
  _previous: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  // checkPermission, not requirePermission: a refusal belongs on the form as a
  // sentence, and Next.js masks thrown errors in production builds.
  const gate = await checkPermission('visits.create');
  if (!gate.ok) return failure(gate.message);

  const parsed = registrationSchema.safeParse({
    patient_new_id: formData.get('patient_new_id'),
    visit_id: formData.get('visit_id'),
    invoice_id: formData.get('invoice_id'),
    patient_id: formData.get('patient_id'),
    full_name: formData.get('full_name'),
    dob: formData.get('dob'),
    age_years: formData.get('age_years'),
    gender: formData.get('gender'),
    phone: formData.get('phone'),
    address: formData.get('address'),
    doctor_id: formData.get('doctor_id'),
    department_id: formData.get('department_id'),
    fee: formData.get('fee'),
    payment_mode: formData.get('payment_mode'),
    deferred: formData.get('deferred'),
    defer_reason: formData.get('defer_reason'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const input = parsed.data;

  /**
   * The two permissions the FORM offers but does not decide.
   *
   * Editing the fee and deferring payment are both money decisions, and both
   * are hidden in the UI from anybody without the permission -- but a POST
   * arrives without passing through the UI, so this is where it is settled
   * (CLAUDE.md 3.6).
   *
   * Deferral is refused outright. An edited fee is not: refusing it would
   * leave a clerk staring at a form they cannot submit for a reason they
   * cannot see, so the doctor's own fee is used instead and the RPC recomputes
   * it from the staff row.
   */
  if (input.deferred) {
    const defer = await checkPermission('billing.defer');
    if (!defer.ok) {
      return failure(
        'You are not allowed to let a patient be seen before paying. Ask a manager.',
      );
    }
  }

  const collect = await checkPermission('billing.collect');
  const fee = collect.ok ? input.fee : null;

  const supabase = await createClient();

  const { data, error } = await registerPatientVisit(supabase, {
    visitId: input.visit_id,
    invoiceId: input.invoice_id,
    patientId: input.patient_id,
    patient: input.patient,
    doctorId: input.doctor_id,
    departmentId: input.department_id,
    // null lets the function fall back to the doctor's consultation_fee.
    fee,
    paymentMode: input.payment_mode,
    deferred: input.deferred,
    deferReason: input.defer_reason,
  });

  if (error) {
    await reportActionError('registerAction', error);
    return failure(describeDatabaseError(error));
  }
  if (!data) return failure('The registration could not be completed. Try again.');

  // The queue is a Server Component; this is what makes it current for anyone
  // who navigates to it next in this tab. Other people's browsers find out
  // through Realtime instead.
  refresh();

  return {
    ...success(`Token ${data.token_no} - ${data.patient_name} (${data.mrn})`),
    result: data,
  };
}

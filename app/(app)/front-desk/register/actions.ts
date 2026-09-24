'use server';

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
    discount: formData.get('discount'),
    discount_reason: formData.get('discount_reason'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const input = parsed.data;

  /**
   * The two money decisions the FORM offers but does not decide.
   *
   * Both are hidden in the UI from anybody without the permission, and that is
   * decoration: a POST arrives without passing through the components that hid
   * them, so this is where each one is settled (CLAUDE.md 3.6).
   *
   * WHAT CHANGED HERE (20260923090100). There used to be a third line:
   *
   *     const collect = await checkPermission('billing.collect');
   *     const fee = collect.ok ? input.fee : null;
   *
   * guarding an editable fee. billing.collect is the permission a register desk
   * exists to hold -- every seeded front_desk role has it -- so that check
   * could never refuse anybody, and the price of a consultation was a free-text
   * field for every receptionist. A 300 rupee fee keyed as 100 produced an
   * invoice saying 100, a payment saying 100, and no record anywhere that a
   * concession had been given. The fee is no longer sent at all: the RPC bills
   * the doctor's own fee and refuses a signed-in caller that disagrees.
   *
   * A reduction now has the shape the billing counter already uses -- an
   * amount, a reason, invoices.discount_amount -- and needs billing.discount,
   * which front_desk does not hold by default and cashier does.
   */
  if (input.deferred) {
    const defer = await checkPermission('billing.defer');
    if (!defer.ok) {
      return failure(
        'You are not allowed to let a patient be seen before paying. Ask a manager.',
      );
    }
  }

  if (input.discount > 0) {
    const discountGate = await checkPermission('billing.discount');
    if (!discountGate.ok) {
      return failure(
        'You are not allowed to give a concession on a bill. Register at the full fee, ' +
          'or ask the billing counter.',
      );
    }
  }

  const supabase = await createClient();

  const { data, error } = await registerPatientVisit(supabase, {
    visitId: input.visit_id,
    invoiceId: input.invoice_id,
    patientId: input.patient_id,
    patient: input.patient,
    doctorId: input.doctor_id,
    departmentId: input.department_id,
    // Always null: the function bills the doctor's own consultation_fee and
    // refuses a signed-in caller that passes anything else.
    fee: null,
    paymentMode: input.payment_mode,
    deferred: input.deferred,
    deferReason: input.defer_reason,
    discount: input.discount,
    discountReason: input.discount_reason,
  });

  if (error) {
    await reportActionError('registerAction', error);
    return failure(describeDatabaseError(error));
  }
  if (!data) return failure('The registration could not be completed. Try again.');

  // No refresh() here. It re-rendered the whole register page -- four more
  // round trips to the database -- before the clerk saw the token, on the one
  // screen where speed decides adoption. The desk bumps its own waiting counts
  // (register-desk.tsx), the queue is dynamic and re-renders when opened, and
  // other browsers find out through Realtime.

  return {
    ...success(`Token ${data.token_no} - ${data.patient_name} (${data.mrn})`),
    result: data,
  };
}

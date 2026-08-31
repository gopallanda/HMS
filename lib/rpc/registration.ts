/**
 * Typed wrapper around register_patient_visit.
 *
 * ONE call, one transaction: the patient and their MRN, the visit and its
 * number, the token for that doctor's queue today, the invoice and its number,
 * and either the payment or the deferral (CLAUDE.md 3.2, block 4.3).
 *
 * There is no partial success to handle here, which is the point. Before this,
 * the desk made three calls and the second or third could fail, leaving a
 * patient with no visit or a visit with no money asked for. Now a failure
 * anywhere leaves nothing at all, and the clerk simply presses the button
 * again.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PaymentMode } from '@/lib/billing';
import type { Database, Json } from '@/types/database';

type Client = SupabaseClient<Database>;

export type RegistrationResult =
  Database['public']['Functions']['register_patient_visit']['Returns'];

export type RegistrationPayload = {
  /** Client-generated, so a resubmitted form registers once (CLAUDE.md 7). */
  visitId: string;
  invoiceId: string;
  /** An existing patient off the search, or null to create `patient`. */
  patientId: string | null;
  patient: {
    id: string;
    full_name: string;
    dob: string;
    gender: Database['public']['Enums']['gender'];
    phone: string | null;
    address: string | null;
  } | null;
  doctorId: string;
  departmentId: string | null;
  /** Null falls back to the doctor's own consultation_fee on the staff row. */
  fee: number | null;
  /** Null exactly when `deferred` is true. */
  paymentMode: PaymentMode | null;
  deferred: boolean;
  deferReason: string | null;
};

export async function registerPatientVisit(supabase: Client, payload: RegistrationPayload) {
  return supabase.rpc('register_patient_visit', {
    // hospital_id is deliberately absent: the function reads it from the JWT
    // and refuses a payload that disagrees (CLAUDE.md 3.1). The same goes for
    // the actor -- p_actor_id is for service-role callers only.
    p_patient_id: payload.patientId,
    p_patient: payload.patient as unknown as Json | null,
    p_doctor_id: payload.doctorId,
    p_department_id: payload.departmentId,
    p_fee: payload.fee,
    p_payment_mode: payload.paymentMode,
    p_deferred: payload.deferred,
    p_defer_reason: payload.deferReason,
    p_visit_id: payload.visitId,
    p_invoice_id: payload.invoiceId,
  });
}

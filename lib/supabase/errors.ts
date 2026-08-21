/**
 * Postgres errors, translated for the person at the desk.
 *
 * A raw "duplicate key value violates unique constraint
 * departments_hospital_id_code_key" is not a message a receptionist can act on,
 * and hiding it entirely violates CLAUDE.md 7 -- so map the codes that have an
 * obvious cause and pass everything else through with its detail intact.
 */

export type DatabaseError = {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

/** Per-constraint wording, keyed by the constraint names in the migrations. */
const CONSTRAINT_MESSAGE: Record<string, string> = {
  departments_hospital_id_code_key: 'Another department already uses that code.',
  departments_hospital_id_lower_name_key: 'A department with that name already exists.',
  memberships_user_hospital_key: 'That user is already a member of this hospital.',
  staff_hospital_id_user_id_key: 'That login is already attached to another staff record.',
  staff_department_same_hospital_fkey:
    'That department belongs to a different hospital.',
  patients_hospital_id_mrn_key: 'That MRN is already in use.',
  visits_hospital_id_visit_no_key: 'That visit number is already in use.',
  visits_hospital_id_day_token_key:
    'That queue token was taken a moment ago. Try again.',
  visits_patient_same_hospital_fkey: 'That patient belongs to a different hospital.',
  visits_doctor_same_hospital_fkey: 'That doctor belongs to a different hospital.',
  visits_department_same_hospital_fkey:
    'That department belongs to a different hospital.',
  charge_items_amount_matches_line:
    'The charge does not add up. Nothing was saved.',
  charge_items_invoice_same_hospital_fkey:
    'That invoice belongs to a different hospital.',
  // Reachable only if two collections somehow drew the same number, which is
  // what next_number's row lock exists to prevent. If this message is ever
  // seen, the invoice was NOT written -- see the concurrency test.
  invoices_hospital_id_invoice_no_key:
    'That invoice number was just used. Nothing was saved -- try again.',
  invoices_grand_total_matches: 'The invoice does not add up. Nothing was saved.',
  invoices_void_has_reason: 'Voiding an invoice needs a reason.',
  invoices_visit_same_hospital_fkey: 'That visit belongs to a different hospital.',
  payments_reversal_has_reason: 'Reversing a payment needs a reason.',
  payments_invoice_same_hospital_fkey:
    'That invoice belongs to a different hospital.',
  // Reachable only if two tabs saved the same visit at the same instant --
  // save_consultation upserts, so the normal second save is an update.
  consultations_hospital_id_visit_id_key:
    'This consultation was saved from somewhere else a moment ago. Reload the visit.',
  consultations_bp_is_a_pair:
    'Enter both halves of the blood pressure, or leave both blank.',
  consultations_bp_systolic_above_diastolic:
    'Systolic has to be higher than diastolic. Check the two boxes.',
  consultations_visit_same_hospital_fkey: 'That visit belongs to a different hospital.',
};

export function describeDatabaseError(error: DatabaseError): string {
  const haystack = `${error.message} ${error.details ?? ''}`;

  // 23514 is here too: several CHECK constraints in this schema exist to catch
  // a specific mistake, and their names are the only way to say which one.
  if (error.code === '23505' || error.code === '23503' || error.code === '23514') {
    for (const [constraint, message] of Object.entries(CONSTRAINT_MESSAGE)) {
      if (haystack.includes(constraint)) return message;
    }
  }

  switch (error.code) {
    case '23505':
      return 'That value is already in use.';
    case '23503':
      return 'That reference points at something that does not exist.';
    case '23514':
      return 'That value is outside the allowed range.';
    case '42501':
      // RLS denied the write, or the JWT has no hospital claim.
      return 'You do not have permission to do that in this hospital.';
    case 'PGRST116':
      return 'That record no longer exists.';
    default:
      return error.message || 'The database rejected that change.';
  }
}

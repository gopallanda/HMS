'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { requireSessionForAction } from '@/lib/auth/session';
import { isFrontDeskRole } from '@/lib/roles';
import { DUPLICATE_PHONE, registerPatient } from '@/lib/rpc/patients';
import { createVisit } from '@/lib/rpc/visits';
import { patientSchema } from '@/lib/schemas/patient';
import { visitSchema } from '@/lib/schemas/visit';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Both actions here return the row they created alongside the usual
 * ActionState, because the desk flow is a chain: registering a patient opens
 * the visit dialog for that patient, and creating a visit prints a token. The
 * client would otherwise have to re-query for something it just wrote.
 */
export type RegisteredPatient = {
  id: string;
  mrn: string;
  full_name: string;
  dob: string;
  phone: string | null;
};

export type RegisterPatientState = ActionState & {
  patient?: RegisteredPatient;
  /** The phone is already on file. Not a failure -- a question for the desk. */
  duplicate?: boolean;
};

export type StartedVisit = {
  id: string;
  visit_no: string;
  token_no: number;
};

export type StartVisitState = ActionState & { visit?: StartedVisit };

export async function registerPatientAction(
  _previous: RegisterPatientState,
  formData: FormData,
): Promise<RegisterPatientState> {
  const session = await requireSessionForAction();
  if (!isFrontDeskRole(session.role)) {
    return failure('Only the front desk can register patients.');
  }

  const parsed = patientSchema.safeParse({
    id: formData.get('id'),
    full_name: formData.get('full_name'),
    dob: formData.get('dob'),
    age_years: formData.get('age_years'),
    gender: formData.get('gender'),
    phone: formData.get('phone'),
    address: formData.get('address'),
    force_create: formData.get('force_create'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  // hospital_id is deliberately not sent: register_patient reads it from the
  // JWT and refuses a payload that disagrees (CLAUDE.md 3.1).
  const { data, error } = await registerPatient(supabase, {
    id: parsed.data.id,
    full_name: parsed.data.full_name,
    dob: parsed.data.dob,
    gender: parsed.data.gender,
    phone: parsed.data.phone,
    address: parsed.data.address,
    force_create: parsed.data.force_create,
  });

  if (error) {
    if (error.code === DUPLICATE_PHONE) {
      return {
        status: 'error',
        message: error.message,
        fieldErrors: { phone: ['Already on file here.'] },
        duplicate: true,
      };
    }
    return failure(describeDatabaseError(error));
  }

  if (!data) return failure('The patient could not be registered. Try again.');

  return {
    ...success(`${data.full_name} registered as ${data.mrn}.`),
    patient: {
      id: data.id,
      mrn: data.mrn,
      full_name: data.full_name,
      dob: data.dob,
      phone: data.phone,
    },
  };
}

export async function startVisitAction(
  _previous: StartVisitState,
  formData: FormData,
): Promise<StartVisitState> {
  const session = await requireSessionForAction();
  if (!isFrontDeskRole(session.role)) {
    return failure('Only the front desk can start a visit.');
  }

  const parsed = visitSchema.safeParse({
    id: formData.get('id'),
    patient_id: formData.get('patient_id'),
    doctor_id: formData.get('doctor_id'),
    department_id: formData.get('department_id'),
    visit_type: formData.get('visit_type'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await createVisit(supabase, {
    id: parsed.data.id,
    patient_id: parsed.data.patient_id,
    doctor_id: parsed.data.doctor_id,
    department_id: parsed.data.department_id,
    visit_type: parsed.data.visit_type,
  });

  if (error) return failure(describeDatabaseError(error));
  if (!data) return failure('The visit could not be created. Try again.');

  // The queue is a server component; this is what makes it current for anyone
  // who navigates to it next in this tab. Other people's browsers find out
  // through Realtime instead.
  refresh();

  return {
    ...success(`Token ${data.token_no} - ${data.visit_no}`),
    visit: { id: data.id, visit_no: data.visit_no, token_no: data.token_no },
  };
}

/**
 * Roles.
 *
 * The enum itself lives in Postgres (public.app_role). This file is the one
 * place the app decides what each role is CALLED and what it may reach, so a
 * new role means one edit here plus one migration, not a grep.
 *
 * AppRole is re-exported from the generated database types on purpose: when
 * types/database.ts is regenerated (CLAUDE.md 9 step 4) a role added in SQL
 * but forgotten here becomes a type error in ROLE_LABEL below.
 */

import type { Database } from '@/types/database';

export type AppRole = Database['public']['Enums']['app_role'];

/** Display order: decision makers first, then the desks, then the departments. */
export const APP_ROLES = [
  'super_admin',
  'admin',
  'doctor',
  'front_desk',
  'cashier',
  'pharmacist',
  'lab_tech',
  'nurse',
] as const satisfies readonly AppRole[];

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  doctor: 'Doctor',
  front_desk: 'Front desk',
  cashier: 'Cashier',
  pharmacist: 'Pharmacist',
  lab_tech: 'Lab technician',
  nurse: 'Nurse',
};

export function roleLabel(role: AppRole | null | undefined): string {
  return role ? ROLE_LABEL[role] : 'No role';
}

/** Roles that may reach /admin. Keep in sync with public.is_hospital_admin(). */
export const ADMIN_ROLES = ['super_admin', 'admin'] as const satisfies readonly AppRole[];

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin';
}

/**
 * Roles that may register a patient and start a visit.
 *
 * Keep in sync with public.assert_front_desk(): this check decides what the UI
 * offers, that one decides what the database accepts. The second is the real
 * boundary -- a Server Action answers a POST without passing through any page
 * (CLAUDE.md 5).
 */
export const FRONT_DESK_ROLES = [
  'super_admin',
  'admin',
  'front_desk',
] as const satisfies readonly AppRole[];

export function isFrontDeskRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'front_desk';
}

/**
 * Roles that may raise an invoice, take a payment and close the day.
 *
 * Keep in sync with public.assert_billing() and with the select policies on
 * invoices and payments: this check decides what the UI offers, those decide
 * what the database accepts, and the second is the real boundary.
 *
 * In hospitals where reception also takes money, add 'front_desk' here and in
 * 20260819090000_invoices_payments.sql. Those two places are the whole change.
 */
export const BILLING_ROLES = [
  'super_admin',
  'admin',
  'cashier',
] as const satisfies readonly AppRole[];

export function isBillingRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'cashier';
}

/**
 * Roles that may open a consultation and record vitals or notes.
 *
 * Keep in sync with public.assert_clinical() and with
 * consultations_select_clinical: this check decides what the UI offers, those
 * decide what the database accepts, and the second is the real boundary.
 *
 * Nurses are here because vitals are taken before the doctor sees the patient.
 * The narrower rule -- a DOCTOR may only write on the visits booked to them --
 * lives in save_consultation, because it depends on the visit, not the role.
 */
export const CLINICAL_ROLES = [
  'super_admin',
  'admin',
  'doctor',
  'nurse',
] as const satisfies readonly AppRole[];

export function isClinicalRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'doctor' || role === 'nurse';
}

/**
 * Only doctors bill a consultation fee. The staff form uses this to decide
 * whether to show the fee field at all -- a nurse with a consultation fee is a
 * charge waiting to be raised by accident in Phase 1.
 */
export function chargesConsultationFee(role: AppRole): boolean {
  return role === 'doctor';
}

/**
 * Registration, as one form.
 *
 * Block 4. The desk used to post three times -- patient, then visit, then
 * nothing -- and a clerk could stop after the first, leaving a visit with no
 * doctor, no token and no money asked for. This schema describes the WHOLE
 * transaction, and register_patient_visit() applies the same three rules again
 * because an RPC answers a POST without the form (CLAUDE.md 7).
 *
 * The three rules:
 *
 *   1. A doctor is required. Always, no exception at the desk.
 *   2. A payment mode is required -- unless the deferral path was used.
 *   3. A deferral requires a typed reason.
 *
 * What is deliberately NOT a rule: a phone number already on file. A phone
 * number identifies a household, not a person, and Indian families share one
 * mobile. That was defect 4, and the fix is that nothing here even looks.
 */

import { z } from 'zod';

import { PAYMENT_MODES } from '@/lib/billing';
import { GENDERS } from '@/lib/patients';
import { clientId, money, optionalId, optionalText, phone, text } from '@/lib/schemas/form';
import { resolveDob } from '@/lib/schemas/patient';

/** The minimum a reason has to say to be worth recording. */
const MIN_REASON = 5;

export const registrationSchema = z
  .object({
    /**
     * Three client-minted ids (CLAUDE.md 7). A form resubmitted after a
     * dropped connection returns the same patient, visit and invoice rather
     * than registering the person twice and billing them twice -- which on
     * this screen is the single most expensive mistake available.
     */
    patient_new_id: clientId,
    visit_id: clientId,
    invoice_id: clientId,

    /** Set when the desk picked somebody off the search. Then the
     *  demographics below are ignored -- they are the existing record's. */
    patient_id: optionalId,

    full_name: z.string().trim().nullish().transform((value) => value ?? ''),
    dob: z.string().trim().nullish().transform((value) => value ?? ''),
    age_years: z.string().trim().nullish().transform((value) => value ?? ''),
    gender: z.string().trim().nullish().transform((value) => value ?? ''),
    phone: phone(),
    address: optionalText('Address', 300),

    doctor_id: z.uuid('Choose a doctor.'),
    department_id: optionalId,

    fee: money('Consultation fee'),
    payment_mode: z.string().trim().nullish().transform((value) => value ?? ''),

    deferred: z
      .union([z.boolean(), z.string(), z.undefined(), z.null()])
      .transform((value) => value === true || value === 'on' || value === 'true'),
    defer_reason: z.string().trim().nullish().transform((value) => value ?? ''),
  })
  .transform((value, ctx) => {
    // Tracked by hand rather than read off the context: an issue added through
    // ctx is not visible on it afterwards, so the only reliable record of "we
    // already failed" is the one this function keeps.
    let failed = false;

    // ---- The patient -------------------------------------------------------
    let patient: {
      id: string;
      full_name: string;
      dob: string;
      gender: (typeof GENDERS)[number];
      phone: string | null;
      address: string | null;
    } | null = null;

    if (value.patient_id === null) {
      const name = text('Patient name', 2, 120).safeParse(value.full_name);
      if (!name.success) {
        failed = true;
        ctx.addIssue({
          code: 'custom',
          path: ['full_name'],
          message: name.error.issues[0]?.message ?? 'Patient name is required.',
        });
      }

      const gender = z.enum(GENDERS).safeParse(value.gender);
      if (!gender.success) {
        failed = true;
        ctx.addIssue({
          code: 'custom',
          path: ['gender'],
          message: 'Choose male, female or other.',
        });
      }

      const dob = resolveDob(value.dob, value.age_years, ctx);
      if (dob === z.NEVER) failed = true;

      if (name.success && gender.success && dob !== z.NEVER) {
        patient = {
          id: value.patient_new_id,
          full_name: name.data,
          dob,
          gender: gender.data,
          phone: value.phone,
          address: value.address,
        };
      }
    }

    // ---- The money ---------------------------------------------------------
    let mode: (typeof PAYMENT_MODES)[number] | null = null;
    let reason: string | null = null;

    if (value.deferred) {
      // A deferral is rare, visible and auditable -- so it costs a sentence.
      // "Patient cannot pay now" with nothing after it is the silent skip this
      // path exists to replace.
      if (value.defer_reason.length < MIN_REASON) {
        failed = true;
        ctx.addIssue({
          code: 'custom',
          path: ['defer_reason'],
          message: 'Say why the patient is being seen before paying.',
        });
      } else {
        reason = value.defer_reason;
      }
    } else {
      const parsed = z.enum(PAYMENT_MODES).safeParse(value.payment_mode);
      if (!parsed.success) {
        failed = true;
        ctx.addIssue({
          code: 'custom',
          path: ['payment_mode'],
          message: 'Record how the payment was made: cash, UPI or card.',
        });
      } else {
        mode = parsed.data;
      }
    }

    if (failed) return z.NEVER;

    return {
      visit_id: value.visit_id,
      invoice_id: value.invoice_id,
      patient_id: value.patient_id,
      patient,
      doctor_id: value.doctor_id,
      department_id: value.department_id,
      fee: value.fee,
      payment_mode: mode,
      deferred: value.deferred,
      defer_reason: reason,
    };
  });

export type RegistrationInput = z.infer<typeof registrationSchema>;

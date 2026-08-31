/**
 * Patient registration.
 *
 * The rule this file exists to enforce: the database stores a DATE OF BIRTH,
 * never an age (CLAUDE.md 3.3). An age integer is wrong the day after it is
 * typed, and every paediatric dose and every senior-citizen concession is
 * computed from the date.
 *
 * The desk still needs to be able to type an age, because a large share of
 * adult patients do not know their birthday -- so the form takes either, and
 * this schema turns an age into a date before it reaches Postgres. What the
 * column never holds is the integer.
 *
 * The same checks run again inside register_patient(): an RPC is reachable
 * without the form.
 */

import { z } from 'zod';

import { GENDERS } from '@/lib/patients';
import { optionalText, phone, text } from '@/lib/schemas/form';
import { todayIst } from '@/lib/utils/dates';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The oldest a patient can plausibly be. Anything beyond it is a typo. */
const MAX_AGE_YEARS = 130;

/** Is this a real calendar date, and not 2026-02-31? */
function isRealDate(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;

  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return (
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
  );
}

/**
 * The date an age in years implies, counted back from today in IST.
 *
 * Approximate by construction, and that is the honest answer: the patient said
 * "about forty". 29 February walks back to the 28th in a non-leap year rather
 * than producing a date that does not exist.
 */
export function dobFromAgeYears(years: number, today: string = todayIst()): string {
  const match = DATE_ONLY.exec(today);
  if (!match) return today;

  const [, y, m, d] = match;
  const year = Number(y) - years;
  let day = Number(d);

  if (Number(m) === 2 && day === 29 && !isRealDate(`${year}-02-29`)) {
    day = 28;
  }

  return `${String(year).padStart(4, '0')}-${m}-${String(day).padStart(2, '0')}`;
}

/** Age in whole years implied by a date of birth, for prefilling the age box. */
export function ageYearsFromDob(dob: string, today: string = todayIst()): number | null {
  if (!isRealDate(dob)) return null;

  const [by, bm, bd] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);

  let years = ty - by;
  if (tm < bm || (tm === bm && td < bd)) years -= 1;

  return years < 0 ? null : years;
}

/**
 * Resolves the date of birth from whichever of the two fields was filled in,
 * and reports the problem against the field the operator actually used.
 *
 * Exported for lib/schemas/registration.ts, which asks the same question
 * inside a larger form. A second copy of these bounds would eventually accept
 * a date this one rejects.
 */
export function resolveDob(
  dob: string,
  ageYears: string,
  ctx: z.RefinementCtx,
): string | typeof z.NEVER {
  const today = todayIst();

  if (dob !== '') {
    if (!isRealDate(dob)) {
      ctx.addIssue({ code: 'custom', path: ['dob'], message: 'That is not a real date.' });
      return z.NEVER;
    }
    if (dob > today) {
      ctx.addIssue({
        code: 'custom',
        path: ['dob'],
        message: 'Date of birth cannot be in the future.',
      });
      return z.NEVER;
    }
    if (dob < dobFromAgeYears(MAX_AGE_YEARS, today)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dob'],
        message: `Date of birth cannot be more than ${MAX_AGE_YEARS} years ago.`,
      });
      return z.NEVER;
    }
    return dob;
  }

  if (ageYears !== '') {
    if (!/^\d{1,3}$/.test(ageYears)) {
      ctx.addIssue({
        code: 'custom',
        path: ['age_years'],
        message: 'Age must be a whole number of years.',
      });
      return z.NEVER;
    }

    const years = Number(ageYears);
    if (years > MAX_AGE_YEARS) {
      ctx.addIssue({
        code: 'custom',
        path: ['age_years'],
        message: `Age cannot be more than ${MAX_AGE_YEARS}.`,
      });
      return z.NEVER;
    }

    return dobFromAgeYears(years, today);
  }

  ctx.addIssue({
    code: 'custom',
    path: ['dob'],
    message: 'Enter a date of birth, or an age if the patient does not know it.',
  });
  return z.NEVER;
}

/**
 * There is no `patientSchema` here any more.
 *
 * Registration is one form and one transaction (block 4), so the rules for a
 * NEW patient live in lib/schemas/registration.ts alongside the doctor, the
 * fee and the payment mode -- they are validated together or not at all. What
 * stayed is resolveDob() above, which both files use, and patientEditSchema
 * below, which is a genuinely different job.
 */

/**
 * Correcting a record that already exists.
 *
 * Three deliberate differences from patientSchema above:
 *
 *  - No `mrn`. The number is allocated by next_number and printed on every
 *    document the patient is holding, so it is displayed on the record screen
 *    and never bound to an input (CLAUDE.md 3.2 -- a consumed number stays
 *    consumed).
 *  - No `hospital_id`. The update is scoped by the session's claim and by
 *    patients_update_desk; a form is not allowed a say in which tenant it
 *    writes to (CLAUDE.md 3.1).
 *  - No `force_create`. The duplicate-phone question belongs to registration:
 *    two people already sharing a mobile is the normal case here, and there is
 *    no second row about to be created.
 *
 * `id` is the row being corrected, not a minted one -- the same dob-or-age
 * resolution runs, because a correction is exactly where "we typed 44 and it
 * should have been 24" gets fixed.
 */
export const patientEditSchema = z
  .object({
    id: z.uuid('Invalid patient.'),
    full_name: text('Patient name', 2, 120),
    dob: z.string().trim().nullish().transform((value) => value ?? ''),
    age_years: z.string().trim().nullish().transform((value) => value ?? ''),
    gender: z.enum(GENDERS, { error: 'Choose male, female or other.' }),
    phone: phone(),
    address: optionalText('Address', 300),
  })
  .transform((value, ctx) => {
    const dob = resolveDob(value.dob, value.age_years, ctx);
    if (dob === z.NEVER) return z.NEVER;

    return {
      id: value.id,
      full_name: value.full_name,
      dob,
      gender: value.gender,
      phone: value.phone,
      address: value.address,
    };
  });

export type PatientEditInput = z.infer<typeof patientEditSchema>;

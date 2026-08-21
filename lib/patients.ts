/**
 * Patients.
 *
 * The gender enum lives in Postgres (public.gender). This file is the one
 * place the app decides what each value is called, the same arrangement as
 * lib/roles.ts -- and, like that file, the type is re-exported from the
 * generated database types so a value added in SQL and forgotten here becomes
 * a type error in GENDER_LABEL rather than a blank cell on a chart.
 */

import type { Database } from '@/types/database';
import { formatAge } from '@/lib/utils/age-from-dob';

export type Gender = Database['public']['Enums']['gender'];

export const GENDERS = ['male', 'female', 'other'] as const satisfies readonly Gender[];

export const GENDER_LABEL: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
};

/** M / F / O -- what fits in a table column and on a thermal receipt. */
export const GENDER_SHORT: Record<Gender, string> = {
  male: 'M',
  female: 'F',
  other: 'O',
};

/**
 * "34 Y / M" -- how an Indian OPD chart reads, and short enough for a dense
 * table. Age is computed from dob every time it is shown (CLAUDE.md 3.3).
 */
export function ageGender(dob: string, gender: Gender): string {
  return `${formatAge(dob)} / ${GENDER_SHORT[gender]}`;
}

/**
 * Recording a consultation.
 *
 * Shared by the form and the Server Action (CLAUDE.md 7), so a pulse of 1200
 * is refused in the browser and refused again on the server -- and a third
 * time by the CHECK constraint, which is the one that actually counts.
 *
 * Every vital is optional and independently so. A patient in for a dressing
 * change gets a pulse taken and nothing else; a form that demanded all six
 * would be filled with invented numbers inside a week.
 */

import { z } from 'zod';

import { VITALS, type VitalKey } from '@/lib/consultations';
import { clientId, optionalText } from '@/lib/schemas/form';

/**
 * One prescription line.
 *
 * Only `drug` is required, matching the CHECK constraint: everything else on a
 * line is genuinely optional, because "Paracetamol 650, SOS" is a real
 * prescription and a form that demanded a duration for it would be filled in
 * with a full stop.
 */
export const prescriptionLineSchema = z.object({
  drug: z
    .string({ error: 'Name the drug.' })
    .trim()
    .min(1, 'Name the drug.')
    .max(120, 'That drug name is too long.'),
  strength: optionalText('Strength', 60),
  dose: optionalText('Dose', 60),
  frequency: optionalText('Frequency', 60),
  duration: optionalText('Duration', 60),
  notes: optionalText('Instructions', 200),
});

export type PrescriptionLineInput = z.infer<typeof prescriptionLineSchema>;

/**
 * The prescription travels as one JSON string in a hidden field, the same way
 * the bill lines do on the collect desk: a list of a list does not fit flat
 * FormData, and this keeps the form a plain <form action={...}>.
 *
 * Blank rows are dropped in the browser before this sees them. A row with no
 * drug that reaches here is a bug, and it is REFUSED rather than quietly
 * skipped -- silently dropping a line off a prescription is the worst thing
 * this file could do.
 */
const prescriptionLines = z
  .string()
  .transform((raw, ctx) => {
    if (raw.trim() === '') return [] as unknown;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'The prescription could not be read. Nothing was saved -- reload the visit.',
      });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(prescriptionLineSchema)
      .max(20, 'A prescription can carry twenty lines. Split it if you need more.'),
  );

/**
 * An empty box means "not taken", not zero. Anything else must be a number
 * inside the column's range -- and rounded to the precision the column holds,
 * so a pasted 98.63 is stored as 98.6 rather than rejected by numeric(4,1).
 */
function vital(spec: (typeof VITALS)[number]) {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx) => {
      const asString = raw == null ? '' : String(raw).trim();
      if (asString === '') return null;

      const value = Number(asString);
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: 'custom', message: `${spec.label} must be a number.` });
        return z.NEVER;
      }
      if (value < spec.min || value > spec.max) {
        ctx.addIssue({
          code: 'custom',
          message: `${spec.label} must be between ${spec.min} and ${spec.max} ${spec.unit}.`,
        });
        return z.NEVER;
      }

      // step 1 -> whole numbers, 0.1 -> one decimal, 0.01 -> two.
      const places = spec.step >= 1 ? 0 : String(spec.step).split('.')[1].length;
      const factor = 10 ** places;
      return Math.round(value * factor) / factor;
    })
    .nullable();
}

const vitalFields = Object.fromEntries(VITALS.map((spec) => [spec.key, vital(spec)])) as {
  [K in VitalKey]: ReturnType<typeof vital>;
};

export const consultationSchema = z
  .object({
    /** Client-generated (CLAUDE.md 7). One id per visit, minted when the screen opens. */
    id: clientId,
    visit_id: z.uuid('Open a visit from your queue first.'),
    ...vitalFields,
    notes: z
      .string()
      .trim()
      .max(20_000, 'These notes are too long to save. Shorten them and try again.')
      .transform((value) => (value === '' ? null : value))
      .nullable(),
    /**
     * What the button pressed means for the queue. `null` leaves the visit
     * where it is -- used when a completed visit is re-opened to fix a typo.
     */
    visit_status: z
      .union([z.literal('in_consultation'), z.literal('completed'), z.literal(''), z.null()])
      .transform((value) => (value === '' || value == null ? null : value)),
    /**
     * The prescription, as written. Always posted whole -- save_consultation
     * replaces the list rather than merging it, so a line the doctor deleted
     * has to be able to disappear.
     */
    prescription: prescriptionLines,
  })
  /**
   * A blood pressure is a pair, and the database says so
   * (consultations_bp_is_a_pair). Catching it here means the doctor sees it
   * under the field rather than as a constraint name in a banner.
   */
  .refine((value) => (value.bp_systolic === null) === (value.bp_diastolic === null), {
    message: 'Enter both halves of the blood pressure, or leave both blank.',
    path: ['bp_diastolic'],
  })
  .refine(
    (value) =>
      value.bp_systolic === null ||
      value.bp_diastolic === null ||
      value.bp_systolic > value.bp_diastolic,
    {
      message: 'Systolic has to be higher than diastolic. Check the two boxes.',
      path: ['bp_diastolic'],
    },
  );

export type ConsultationInput = z.infer<typeof consultationSchema>;

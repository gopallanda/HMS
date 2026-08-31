/**
 * Shifts.
 *
 * The roster exists so that a role which never signs in still has a page. A
 * cleaner has no credentials, no queue and no invoices; what they have is a
 * month of days, each one worked, off, or absent, and a manager who has to be
 * able to say which.
 *
 * hours is sent as well as the times, because the database stores it rather
 * than deriving it at read time: shifts get corrected retroactively and payroll
 * must see what was agreed. When both times are given and hours is left empty,
 * the trigger computes it (20260828090100) -- including across midnight, which
 * housekeeping and nursing both work.
 */

import { z } from 'zod';

import { clientId, optionalText } from '@/lib/schemas/form';

export const SHIFT_STATUSES = [
  'scheduled',
  'present',
  'absent',
  'day_off',
  'leave',
] as const;

export type ShiftStatusValue = (typeof SHIFT_STATUSES)[number];

export const SHIFT_STATUS_LABEL: Record<ShiftStatusValue, string> = {
  scheduled: 'Scheduled',
  present: 'Present',
  absent: 'Absent',
  day_off: 'Day off',
  leave: 'Leave',
};

/** Statuses that cannot carry hours. The trigger clears them too. */
export const NON_WORKING_STATUSES: readonly ShiftStatusValue[] = [
  'absent',
  'day_off',
  'leave',
];

/** '' -> null, so an empty time input does not become the string ''. */
const optionalTime = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = (value ?? '').toString().trim();
    return trimmed === '' ? null : trimmed;
  })
  .refine(
    (value) => value === null || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value),
    'Enter a time as HH:MM.',
  );

const optionalHours = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw, ctx) => {
    const asString = raw == null ? '' : String(raw).trim();
    if (asString === '') return null;

    const value = Number(asString);
    if (!Number.isFinite(value)) {
      ctx.addIssue({ code: 'custom', message: 'Hours must be a number, like 8 or 7.5.' });
      return z.NEVER;
    }
    if (value < 0 || value > 24) {
      ctx.addIssue({ code: 'custom', message: 'Hours must be between 0 and 24.' });
      return z.NEVER;
    }
    // numeric(4,2) is all the column holds.
    return Math.round(value * 100) / 100;
  });

export const shiftSchema = z
  .object({
    id: clientId,
    staff_id: z.uuid('Choose a staff member.'),
    work_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
    status: z.enum(SHIFT_STATUSES, { error: 'Choose a status.' }),
    start_time: optionalTime,
    end_time: optionalTime,
    hours: optionalHours,
    notes: optionalText('Notes', 500),
  })
  .superRefine((shift, ctx) => {
    // Half a range is a slip, not a shift. The database says the same thing;
    // saying it here means the person sees it under the field they mistyped.
    if ((shift.start_time === null) !== (shift.end_time === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [shift.start_time === null ? 'start_time' : 'end_time'],
        message: 'Enter both times, or neither.',
      });
    }
  })
  .transform((shift) => {
    if (NON_WORKING_STATUSES.includes(shift.status)) {
      return { ...shift, start_time: null, end_time: null, hours: null };
    }
    return shift;
  });

export type ShiftInput = z.infer<typeof shiftSchema>;

/** Clearing a cell. The roster is a grid, so "no answer" has to be reachable. */
export const shiftClearSchema = z.object({
  staff_id: z.uuid('Choose a staff member.'),
  work_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
});

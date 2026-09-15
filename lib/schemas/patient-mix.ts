/**
 * The New vs Return report's filters.
 *
 * A GET form, so these arrive as search params and anything can be typed into
 * the address bar. Every field falls back to its default instead of failing:
 * a hand-edited URL with a bad date is a report for the default range, not an
 * error page. The one limit the database enforces on top -- a range of two
 * years or less -- is shown as the report's error when it is exceeded.
 */

import { z } from 'zod';

/** The choices for "came back within". 30 is the default. */
export const RETURN_WINDOWS = [7, 15, 30, 60, 90] as const;
export const DEFAULT_RETURN_WINDOW = 30;

/** How far back the report looks when no range is given. */
export const DEFAULT_RANGE_DAYS = 90;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const patientMixFilterSchema = z.object({
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  window: z.coerce
    .number()
    .int()
    .refine((days) => (RETURN_WINDOWS as readonly number[]).includes(days))
    .catch(DEFAULT_RETURN_WINDOW),
  doctor: z.uuid().optional().catch(undefined),
});

export type PatientMixFilter = z.infer<typeof patientMixFilterSchema>;

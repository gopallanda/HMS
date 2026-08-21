/**
 * Indian financial year: 1 Apr - 31 Mar, rendered as "2026-27".
 *
 * This mirrors public.financial_year() in
 * supabase/migrations/20260818090400_next_number.sql. The database is the
 * authority — numbers are allocated there. This exists for display and for
 * filtering reports. If one changes, change both.
 */

const IST_TIME_ZONE = 'Asia/Kolkata';

/** Calendar parts of `at` as they read in India, wherever the server is. */
function istParts(at: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The year the financial year starts in. FY 2026-27 -> 2026. */
export function financialYearStart(at: Date = new Date()): number {
  const { year, month } = istParts(at);
  return month >= 4 ? year : year - 1;
}

/** "2026-27" */
export function financialYear(at: Date = new Date()): string {
  const start = financialYearStart(at);
  const end = String((start + 1) % 100).padStart(2, '0');
  return `${start}-${end}`;
}

/** Inclusive date range of a financial year, as YYYY-MM-DD strings. */
export function financialYearRange(at: Date = new Date()): {
  from: string;
  to: string;
} {
  const start = financialYearStart(at);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

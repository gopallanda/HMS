/**
 * Dates, always rendered in the hospital's timezone.
 *
 * Postgres stores timestamptz (UTC); the hospital reads IST. Never format a
 * timestamp with the server's local timezone — a Vercel box in Washington
 * would put the day-close report on the wrong day.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';

function fmt(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    ...options,
  });
}

const DATE = fmt({ day: '2-digit', month: 'short', year: 'numeric' });
const TIME = fmt({ hour: '2-digit', minute: '2-digit', hour12: true });
const DATETIME = fmt({
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** "18 Aug 2026" */
export function formatDate(value: string | Date): string {
  return DATE.format(toDate(value));
}

/** "11:27 am" */
export function formatTime(value: string | Date): string {
  return TIME.format(toDate(value));
}

/** "18 Aug 2026, 11:27 am" */
export function formatDateTime(value: string | Date): string {
  return DATETIME.format(toDate(value));
}

/**
 * Today in IST as "YYYY-MM-DD" — the value to send to day_close_report and to
 * seed date inputs with.
 */
export function todayIst(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

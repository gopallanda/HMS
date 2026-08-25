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

/** "Tuesday, 25 August 2026" — the dashboard's date line. */
export function formatLongDate(value: string | Date = new Date()): string {
  return fmt({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(toDate(value));
}

/**
 * "morning" / "afternoon" / "evening", by the clock in the hospital.
 *
 * Read from the IST hour rather than the server's, for the same reason every
 * other formatter here is: a box in Washington would greet the Mumbai front
 * desk with "good evening" at eleven in the morning.
 */
export function greetingIst(at: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: IST_TIME_ZONE,
      hour: '2-digit',
      hour12: false,
    }).format(at),
  );

  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

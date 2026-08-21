/**
 * Age is computed, never stored (CLAUDE.md 3.3). A stored age integer is wrong
 * the day after it is entered.
 *
 * `dob` is a `date` column, so it arrives as "YYYY-MM-DD" with no timezone.
 * Parse it as plain calendar parts — never `new Date("YYYY-MM-DD")`, which is
 * interpreted as UTC midnight and reads back a day earlier in IST.
 */

export type Age = { years: number; months: number; days: number };

function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Days in a given month, 1-indexed month. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function ageFromDob(dob: string, asOf: Date = new Date()): Age | null {
  const birth = parseDateOnly(dob);
  if (!birth) return null;

  let years = asOf.getFullYear() - birth.y;
  let months = asOf.getMonth() + 1 - birth.m;
  let days = asOf.getDate() - birth.d;

  if (days < 0) {
    months -= 1;
    // borrow from the month before "asOf"
    const prevMonth = asOf.getMonth() === 0 ? 12 : asOf.getMonth();
    const prevYear =
      asOf.getMonth() === 0 ? asOf.getFullYear() - 1 : asOf.getFullYear();
    days += daysInMonth(prevYear, prevMonth);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return null; // dob in the future

  return { years, months, days };
}

/**
 * How Indian hospital staff write it on a chart:
 *   adults      "34 Y"
 *   under 2     "7 M 12 D"
 *   under 1 mo  "18 D"
 */
export function formatAge(dob: string, asOf: Date = new Date()): string {
  const age = ageFromDob(dob, asOf);
  if (!age) return '-';
  if (age.years >= 2) return `${age.years} Y`;
  if (age.years === 1) return `${age.years} Y ${age.months} M`;
  if (age.months >= 1) return `${age.months} M ${age.days} D`;
  return `${age.days} D`;
}

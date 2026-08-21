/**
 * Money.
 *
 * Postgres stores numeric(12,2). supabase-js hands numeric back as a JS number,
 * which is fine for the magnitudes a hospital bill reaches (a rupee value under
 * ~9e15 is exact in a double once scaled). What is NOT fine is accumulating
 * float error across additions, so every arithmetic helper here rounds to paise
 * on the way out.
 *
 * Display rule (CLAUDE.md 7): always two decimals, always with the rupee sign,
 * always right-aligned by the caller.
 */

/** Round to paise. 0.1 + 0.2 -> 0.3, not 0.30000000000000004. */
export function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Sum that cannot drift: adds in integer paise. */
export function sumMoney(amounts: number[]): number {
  return fromPaise(amounts.reduce((acc, a) => acc + toPaise(a), 0));
}

/** qty * unitPrice, rounded to paise. */
export function lineAmount(qty: number, unitPrice: number): number {
  return fromPaise(qty * toPaise(unitPrice));
}

/** Tax on an amount at a percentage rate, rounded to paise. */
export function taxAmount(amount: number, taxRatePercent: number): number {
  return fromPaise(Math.round(toPaise(amount) * (taxRatePercent / 100)));
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,23,456.00" — Indian digit grouping. */
export function formatMoney(amount: number): string {
  return INR.format(amount);
}

/** "1,23,456.00" — no symbol, for columns that carry the ₹ in the header. */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty',
  'Ninety',
];

/** 0-99 in words. '' for zero, so callers can drop empty segments. */
function underHundred(value: number): string {
  if (value < 20) return ONES[value];
  const tens = TENS[Math.floor(value / 10)];
  const ones = ONES[value % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/** Whole rupees in words, grouped the Indian way: crore, lakh, thousand. */
function rupeesInWords(value: number): string {
  if (value === 0) return 'Zero';

  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  let rest = value % 10_000_000;

  if (crore > 0) {
    // Recurses rather than capping, so 123 crore reads correctly.
    parts.push(`${crore > 99 ? rupeesInWords(crore) : underHundred(crore)} Crore`);
  }

  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh > 0) parts.push(`${underHundred(lakh)} Lakh`);

  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand > 0) parts.push(`${underHundred(thousand)} Thousand`);

  const hundred = Math.floor(rest / 100);
  rest %= 100;
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);

  if (rest > 0) parts.push(underHundred(rest));

  return parts.join(' ');
}

/**
 * "Rupees Four Thousand Five Hundred and Fifty Paise Only".
 *
 * Indian invoices carry the amount in words as well as figures — it is what
 * makes a printed total hard to alter after the fact, and an accountant will
 * ask where it is if it is missing.
 */
export function amountInWords(amount: number): string {
  const paise = toPaise(Math.abs(amount));
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;

  const head = `Rupees ${rupeesInWords(rupees)}`;
  const tail = remainder > 0 ? ` and ${underHundred(remainder)} Paise` : '';

  return `${head}${tail} Only`;
}

/**
 * Parse operator input. Accepts "1234", "1,234.50", "₹1234".
 * Returns null for anything that is not a clean number — never NaN, so callers
 * are forced to handle bad input instead of writing NaN to the database.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? fromPaise(toPaise(value)) : null;
}

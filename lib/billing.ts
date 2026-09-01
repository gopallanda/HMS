/**
 * Billing.
 *
 * The two enums live in Postgres (public.invoice_status, public.payment_mode).
 * This file is the one place the app decides what each value is CALLED and how
 * it reads on screen -- the same arrangement as lib/roles.ts and lib/visits.ts.
 *
 * The types are re-exported from the generated database types on purpose: a
 * value added in SQL and forgotten here becomes a type error in the label maps
 * below rather than a blank cell on a day-close sheet.
 */

import type { BadgeVariant } from '@/components/ui/badge';
import type { Database } from '@/types/database';

export type InvoiceStatus = Database['public']['Enums']['invoice_status'];
export type PaymentMode = Database['public']['Enums']['payment_mode'];

/**
 * Display order at the counter, not alphabetical: cash and UPI are what an
 * Indian OPD desk actually takes, and they should be the first two keys under
 * the operator's fingers.
 */
export const PAYMENT_MODES = [
  'cash',
  'upi',
  'card',
  'other',
] as const satisfies readonly PaymentMode[];

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  other: 'Other',
};

/**
 * Alt+<n> picks a mode on the collect screen. Kept next to the order above so
 * the hint printed in the toolbar cannot drift from the key that is bound.
 */
export function paymentModeShortcut(mode: PaymentMode): number {
  return PAYMENT_MODES.indexOf(mode) + 1;
}

/** Modes that normally carry a transaction reference. Cash never does. */
export function expectsReference(mode: PaymentMode): boolean {
  return mode === 'upi' || mode === 'card';
}

export const INVOICE_STATUSES = [
  'unpaid',
  'partial',
  'paid',
  'void',
] as const satisfies readonly InvoiceStatus[];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  void: 'Void',
};

/**
 * Badge colour per status.
 *
 * Unpaid is the loud one, and the only status in the app that stays red: it is
 * the one state where the hospital is owed money by somebody who has already
 * walked out. Part paid is amber -- outstanding, but somebody has engaged.
 *
 * Void is muted rather than red. The invoice number is still consumed and the
 * row is still history (CLAUDE.md 3.2); it is a closed matter, not an alarm.
 */
export const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  unpaid: 'destructive',
  partial: 'warning',
  paid: 'success',
  void: 'outline',
};

/** Statuses where money is still outstanding. */
export function isOutstanding(status: InvoiceStatus): boolean {
  return status === 'unpaid' || status === 'partial';
}

/**
 * Which paper a receipt or invoice prints on.
 *
 * Thermal is the default for OPD receipts (CLAUDE.md 7) -- it is the printer
 * bolted to the counter. A5 is the second receipt stylesheet, for a hospital
 * running its counter off a laser printer: half a sheet, same content, no
 * wasted paper. A4 is for anything that leaves the building -- insurance,
 * reimbursement, a company account.
 */
export const PRINT_FORMATS = ['thermal', 'a5', 'a4'] as const;

export type PrintFormat = (typeof PRINT_FORMATS)[number];

export const PRINT_FORMAT_LABEL: Record<PrintFormat, string> = {
  thermal: '80mm roll',
  a5: 'A5 sheet',
  a4: 'A4 invoice',
};

export const PRINT_FORMAT_NOTE: Record<PrintFormat, string> = {
  thermal: 'The roll printer at the counter. The default, and what most OPD desks use.',
  a5: 'Half a sheet on a laser printer. Same receipt, no roll.',
  a4: 'A full invoice, for insurance and company accounts.',
};

export function isPrintFormat(value: unknown): value is PrintFormat {
  return value === 'thermal' || value === 'a5' || value === 'a4';
}

/**
 * The hospital's default paper, from hospitals.settings.receipt_default,
 * chosen at Administration -> Hospital settings -> Printing.
 *
 * Falls back to thermal, because that is what is loaded in the printer at an
 * OPD counter and an unset value is far more likely to mean "nobody has been
 * to settings yet" than "we want A4".
 */
export function defaultPrintFormat(settings: unknown): PrintFormat {
  if (settings && typeof settings === 'object' && 'receipt_default' in settings) {
    const value = (settings as { receipt_default?: unknown }).receipt_default;
    if (isPrintFormat(value)) return value;
  }
  return 'thermal';
}

/**
 * Ageing buckets for the outstanding-dues report.
 *
 * Three, not five. A small hospital chases a debt by ringing the number on the
 * row, and the only decision the bucket drives is whether that call happens
 * today: this week is normal, this month is a reminder, older than that is a
 * conversation with the owner. Finer bands would be a report nobody acts on
 * differently.
 *
 * Here rather than beside the table that renders them, because the page is a
 * Server Component and the table is a Client Component: a plain value imported
 * from a 'use client' module arrives on the server as a client reference, not
 * as the array. That failure is a runtime TypeError, not a type error.
 */
export const AGE_BUCKETS = [
  { key: 'fresh', label: '0-7 days' },
  { key: 'chasing', label: '8-30 days' },
  { key: 'old', label: '31+ days' },
] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number]['key'];

export function bucketFor(ageDays: number): AgeBucket {
  if (ageDays <= 7) return 'fresh';
  if (ageDays <= 30) return 'chasing';
  return 'old';
}

/**
 * A charge line, as every billing screen and both print templates need it.
 * One shape, whether the line came from the visit or was typed at the counter.
 */
export type ChargeLine = {
  id: string;
  description: string;
  qty: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
};

/**
 * Invoice arithmetic, done the same way in the browser as in collect_payment.
 *
 * Tax is per line, never a blanket rate across the invoice (CLAUDE.md 8): a
 * bill can carry an exempt consultation and a taxable strip of paracetamol,
 * and rounding each line separately is what makes the printed total match what
 * Postgres stored.
 *
 * This is a preview, not the authority. The invoice is whatever
 * collect_payment computed inside the transaction.
 */
export function totalsFor(lines: ChargeLine[]): {
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
} {
  let subtotalPaise = 0;
  let taxPaise = 0;

  for (const line of lines) {
    const amountPaise = Math.round(line.amount * 100);
    subtotalPaise += amountPaise;
    taxPaise += Math.round((amountPaise * line.tax_rate) / 100);
  }

  return {
    subtotal: subtotalPaise / 100,
    taxTotal: taxPaise / 100,
    grandTotal: (subtotalPaise + taxPaise) / 100,
  };
}

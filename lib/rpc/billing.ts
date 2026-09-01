/**
 * Typed wrappers around the billing Postgres functions.
 *
 * Like the other files in this directory these take the Supabase client as an
 * argument rather than creating one, so the same wrapper serves a Server Action
 * and a browser read. Nothing here writes a table directly -- on the money
 * tables that is not a style preference, it is the rule the whole schema is
 * built around (CLAUDE.md 3.2). There is no `supabase.from('invoices')
 * .insert()` anywhere in this codebase, and there cannot be: the table has no
 * insert policy.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { PAYMENT_MODES, type PaymentMode } from '@/lib/billing';
import type { Database, Json } from '@/types/database';

type Client = SupabaseClient<Database>;

export type InvoiceRow = Database['public']['Tables']['invoices']['Row'];
export type PaymentRow = Database['public']['Tables']['payments']['Row'];
export type ChargeItemRow = Database['public']['Tables']['charge_items']['Row'];
export type BillingVisitRow = Database['public']['Views']['visit_billing']['Row'];
export type InvoiceSummaryRow = Database['public']['Views']['invoice_summary']['Row'];
export type DayCloseRow =
  Database['public']['Functions']['day_close_report']['Returns'][number];

/**
 * collect_payment raises this when a charge line was billed by somebody else
 * between the screen loading and the Paid button being pressed. Two cashiers,
 * one visit. It is a reload-and-look-again, not a crash
 * (see supabase/migrations/20260819090100_billing_rpcs.sql).
 */
export const ALREADY_BILLED = '90002';

/** One line on the bill, in the shape collect_payment expects. */
export type CollectPaymentItem =
  | { charge_item_id: string }
  | { service_id: string; description: string; qty: number; unit_price: number };

export type CollectPaymentPayload = {
  /** Client-generated, so a resubmitted form bills once (CLAUDE.md 7). */
  invoiceId: string;
  visitId: string;
  items: CollectPaymentItem[];
  mode: PaymentMode;
  amount: number;
  reference: string | null;
  /**
   * A concession, applied AFTER tax (item 4). Zero on almost every bill, and
   * the reason is required whenever it is not: a discount with no reason is
   * indistinguishable from a mis-key by the time anybody asks.
   */
  discount: number;
  discountReason: string | null;
};

/**
 * The only path that creates an invoice.
 *
 * One transaction in Postgres: raise the ad-hoc charges, lock and total the
 * lines, draw the number from number_series, write the invoice, attach the
 * lines, record the payment. Nothing partial can survive a failure.
 *
 * hospital_id and collected_by are deliberately not sent: the function reads
 * them from the JWT and refuses a payload that disagrees.
 */
export async function collectPayment(supabase: Client, payload: CollectPaymentPayload) {
  return supabase.rpc('collect_payment', {
    p_visit_id: payload.visitId,
    p_items: payload.items as unknown as Json,
    p_mode: payload.mode,
    p_amount: payload.amount,
    p_reference: payload.reference,
    p_invoice_id: payload.invoiceId,
    p_discount: payload.discount,
    p_discount_reason: payload.discountReason,
  });
}

export type AddPaymentPayload = {
  invoiceId: string;
  /** Client-generated, so a resubmitted dialog banks the money once. */
  paymentId: string;
  amount: number;
  mode: PaymentMode;
  reference: string | null;
};

/**
 * Settle some or all of an invoice that already exists.
 *
 * The other half of collect_payment, and deliberately not part of it: this one
 * never draws an invoice number and never writes an invoice row. It locks the
 * invoice, checks the amount against the real outstanding balance, records the
 * payment and recomputes the status from the payment rows.
 *
 * hospital_id and collected_by are not sent, for the same reason
 * collectPayment does not send them: the function reads both from the JWT and
 * refuses a payload that disagrees.
 */
export async function addPayment(supabase: Client, payload: AddPaymentPayload) {
  return supabase.rpc('add_payment', {
    p_invoice_id: payload.invoiceId,
    p_amount: payload.amount,
    p_mode: payload.mode,
    p_reference: payload.reference,
    p_payment_id: payload.paymentId,
  });
}

/**
 * Reverse ONE payment, with a typed reason, leaving the invoice standing.
 *
 * Not a smaller void: voiding retires the whole bill, releases its lines and
 * reverses every payment on it. This corrects a single row -- a cash
 * collection keyed as UPI, a reference typed against the wrong bill -- and
 * recomputes the invoice status from what is left.
 *
 * It records a correction and moves no cash. The refund happens at the
 * counter, and the screen that offers this says so.
 */
export async function reversePayment(supabase: Client, paymentId: string, reason: string) {
  return supabase.rpc('reverse_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });
}

/**
 * Voids an invoice with a typed reason: the lines go back to pending, the
 * payments are reversed, the number stays consumed. Nothing is deleted.
 */
export async function voidInvoice(supabase: Client, invoiceId: string, reason: string) {
  return supabase.rpc('void_invoice', {
    p_invoice_id: invoiceId,
    p_reason: reason,
  });
}

export type DayClosureRow = Database['public']['Tables']['day_closures']['Row'];

/**
 * Record that a day was counted.
 *
 * The system figure is read inside the transaction, so the variance is against
 * the numbers the person closing was looking at rather than against whatever
 * the table says a moment later. Closing locks nothing: a re-close updates the
 * same row and the audit trail carries both counts.
 */
export async function closeDay(
  supabase: Client,
  date: string,
  declaredCash: number,
  notes: string | null,
) {
  return supabase.rpc('close_day', {
    p_date: date,
    p_declared_cash: declaredCash,
    p_notes: notes,
  });
}

/** Read-only day close for one IST day. */
export async function dayCloseReport(supabase: Client, hospitalId: string, date: string) {
  return supabase.rpc('day_close_report', {
    p_hospital_id: hospitalId,
    p_date: date,
  });
}

/**
 * Day-close rows arrive as one flat table with a `bucket` discriminator, so
 * the screen makes a single round trip and every section is guaranteed to come
 * from the same snapshot. This splits it back apart.
 */
export function groupDayClose(rows: DayCloseRow[]) {
  const of = (bucket: DayCloseRow['bucket']) => rows.filter((row) => row.bucket === bucket);
  const total = (key: string) =>
    rows.find((row) => row.bucket === 'total' && row.key === key) ?? null;

  return {
    collected: total('collected'),
    invoiced: total('invoiced'),
    voided: total('voided'),
    /**
     * Concessions given on the day's bills (item 5). The leakage figure, and
     * the reason it sits with the other three totals rather than in a report
     * of its own: "we collected 41,000" is not a day anybody can reconcile
     * without "and gave away 2,300" beside it.
     */
    discounted: total('discounted'),
    // UNION ALL does not promise an order. The modes are shown in the same
    // sequence every day (cash first, as at the counter), the other two by
    // size, because the biggest line is the one being reconciled first.
    byMode: of('mode').sort(
      (a, b) =>
        PAYMENT_MODES.indexOf(a.key as PaymentMode) -
        PAYMENT_MODES.indexOf(b.key as PaymentMode),
    ),
    byStaff: of('staff').sort((a, b) => b.amount - a.amount),
    byDepartment: of('department').sort((a, b) => b.amount - a.amount),
  };
}

/**
 * Taking money.
 *
 * The same schema runs in the browser and in the Server Action (CLAUDE.md 7),
 * and a third copy of the same rules lives in collect_payment() because an RPC
 * is reachable without the form. That is deliberate duplication: the form is
 * there to stop a mistake being made, the RPC is there to stop it being
 * written.
 *
 * The bill lines cannot travel as flat FormData -- a bill is a list of a list.
 * They are posted as one JSON string in a hidden field and parsed here, which
 * keeps the form a plain <form action={...}> with no fetch in it.
 */

import { z } from 'zod';

import { PAYMENT_MODES } from '@/lib/billing';
import { clientId, money, optionalText, text } from '@/lib/schemas/form';

/**
 * A line on the bill. Two kinds, told apart by `kind`:
 *
 *   existing  a charge_item already pending on the visit -- the consultation
 *             fee create_visit raised, a procedure the doctor added.
 *   service   an ad-hoc charge picked from the services master at the counter.
 *             The price pre-fills from the service and stays editable; the tax
 *             rate does not travel at all, because collect_payment reads it
 *             from the service itself (CLAUDE.md 8).
 */
export const billLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    charge_item_id: z.uuid('That charge is no longer valid.'),
  }),
  z.object({
    kind: z.literal('service'),
    service_id: z.uuid('Choose a service.'),
    description: text('Description', 1, 200),
    qty: z
      .number({ error: 'Quantity must be a number.' })
      .positive('Quantity must be more than zero.')
      .max(9999, 'Quantity looks wrong.'),
    unit_price: z
      .number({ error: 'Price must be a number.' })
      .min(0, 'Price cannot be negative.')
      .max(999_999.99, 'Price looks wrong.'),
  }),
]);

export type BillLine = z.infer<typeof billLineSchema>;

/** The JSON string in the hidden field, parsed into lines. */
const billLines = z
  .string({ error: 'Add at least one charge to the bill.' })
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'The bill could not be read. Reload the visit.' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(billLineSchema)
      .min(1, 'Add at least one charge to the bill.')
      .max(100, 'That is more lines than one invoice should carry.'),
  );

export const collectPaymentSchema = z.object({
  /**
   * Client-generated (CLAUDE.md 7). This is the field that stops a double-click
   * or a resubmit after a dropped connection from billing the patient twice --
   * collect_payment returns the invoice it already wrote instead of a second
   * one.
   */
  invoice_id: clientId,
  visit_id: z.uuid('Choose a visit to bill.'),
  items: billLines,
  mode: z.enum(PAYMENT_MODES, { error: 'Choose how the payment was made.' }),
  /**
   * What was actually collected. Zero is allowed and means "bill now, pay
   * later": the invoice is raised unpaid. More than the bill is refused by
   * collect_payment -- change handed back is not a payment.
   */
  amount: money('Amount'),
  reference: optionalText('Reference', 80),
});

export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;

/**
 * Settling a balance on an invoice that already exists.
 *
 * Separate from collectPaymentSchema rather than a variant of it, because the
 * two forms ask different questions: that one asks what to bill, this one asks
 * only what was handed over. There are no lines here at all -- the bill was
 * raised when the invoice was.
 *
 * The amount is deliberately NOT bounded against the balance here. The browser
 * knows a balance that was true when the page rendered, and a second cashier
 * may have collected against it since; add_payment re-reads it under a row
 * lock and names the real figure in the refusal. A client-side maximum would
 * only be a worse copy of that.
 */
export const addPaymentSchema = z.object({
  invoice_id: z.uuid('That invoice is no longer valid.'),
  /** Client-generated, so a double-click banks the money once. */
  payment_id: clientId,
  amount: money('Amount').refine((value) => value > 0, 'Enter the amount collected.'),
  mode: z.enum(PAYMENT_MODES, { error: 'Choose how the payment was made.' }),
  reference: optionalText('Reference', 80),
});

export type AddPaymentInput = z.infer<typeof addPaymentSchema>;

/**
 * Voiding.
 *
 * A typed reason, never a bare confirm dialog (CLAUDE.md 7). The minimum
 * length is enforced here and again in void_invoice(); "x" is not a reason and
 * this is the one field an auditor will read a year from now.
 */
export const voidInvoiceSchema = z.object({
  invoice_id: z.uuid('That invoice is no longer valid.'),
  reason: text('Reason', 4, 200),
});

export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

/**
 * Reversing one payment.
 *
 * The same typed-reason rule as voiding, and the same minimum, because the two
 * records are read side by side: "why is this bill void" and "why is this
 * collection not counted" are the same question asked of different rows.
 */
export const reversePaymentSchema = z.object({
  payment_id: z.uuid('That payment is no longer valid.'),
  reason: text('Reason', 4, 200),
});

export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

/** The day-close date picker. IST calendar day, as YYYY-MM-DD. */
export const dayCloseSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.')
    .optional(),
});

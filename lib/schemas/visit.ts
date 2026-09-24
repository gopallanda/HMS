/**
 * Cancelling a visit.
 *
 * A typed reason, never a bare confirm dialog (CLAUDE.md 7). The minimum is
 * the same 5 characters transfer_visit asks for and cancel_visit enforces
 * again, because an RPC answers a POST without the form: the same rules on
 * both sides of the wire, with the form there to stop the mistake being made
 * and the function there to stop it being written.
 *
 * The reason is the whole value of this record a month later. A cancelled
 * token with "x" against it explains nothing to the person who finds it.
 */

import { z } from 'zod';

import { text } from '@/lib/schemas/form';

export const cancelVisitSchema = z.object({
  visit_id: z.uuid('That visit is no longer valid.'),
  reason: text('Reason', 5, 200),
  /**
   * What happens to money already collected (20260923090000).
   *
   * Defaults to `retain` when the field is absent, which is the answer that
   * moves no money: the paid invoice is left alone and goes on recording cash
   * that is still in the drawer. `refund` voids the invoice and reverses the
   * payment, and the action checks billing.void before it is honoured -- a
   * POST arrives without passing through the dialog that hid the option
   * (CLAUDE.md 3.6).
   *
   * Never defaulted to `refund`. A field somebody forgot to send must not be
   * the one that hands money back.
   */
  money: z
    .enum(['retain', 'refund'])
    .nullish()
    .transform((value) => value ?? 'retain'),
});

export type CancelVisitInput = z.infer<typeof cancelVisitSchema>;

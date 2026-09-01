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
});

export type CancelVisitInput = z.infer<typeof cancelVisitSchema>;

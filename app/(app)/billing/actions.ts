'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { addPayment } from '@/lib/rpc/billing';
import { addPaymentSchema } from '@/lib/schemas/billing';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Money actions that belong to the billing MODULE rather than to one screen.
 *
 * Collecting a balance is offered from three places -- the invoice list, the
 * PAYMENT DUE badge on the front-desk queue, and the patient money panel --
 * and all three open the same dialog. One action, at the section root, so
 * there is one permission check and one set of words to keep right.
 */

export type AddPaymentState = ActionState & {
  /** Set on success, so the dialog can offer the receipt. */
  invoice?: {
    id: string;
    invoice_no: string;
    grand_total: number;
    status: string;
  };
};

/**
 * Settle some or all of an invoice that already exists.
 *
 * checkPermission rather than requirePermission, for the same reason
 * registerAction gives: a refusal belongs on the form as a sentence, and
 * Next.js masks a thrown error in a production build as "an unexpected error
 * occurred", which tells a clerk nothing.
 *
 * Every rule that matters is in add_payment(), under a row lock on the invoice
 * (CLAUDE.md 3.2). This validates early so the counter is told before the
 * round trip, and gets out of the way.
 */
export async function addPaymentAction(
  _previous: AddPaymentState,
  formData: FormData,
): Promise<AddPaymentState> {
  const gate = await checkPermission('billing.collect');
  if (!gate.ok) return failure(gate.message);

  const parsed = addPaymentSchema.safeParse({
    invoice_id: formData.get('invoice_id'),
    payment_id: formData.get('payment_id'),
    amount: formData.get('amount'),
    mode: formData.get('mode'),
    reference: formData.get('reference'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await addPayment(supabase, {
    invoiceId: parsed.data.invoice_id,
    paymentId: parsed.data.payment_id,
    amount: parsed.data.amount,
    mode: parsed.data.mode,
    reference: parsed.data.reference,
  });

  if (error) return failure(describeDatabaseError(error));
  if (!data) return failure('The payment could not be recorded. Nothing was collected.');

  // The queue badge, the invoice row and the patient balance are all rendered
  // on the server and all three have just changed.
  refresh();

  return {
    ...success(
      data.status === 'paid'
        ? `${data.invoice_no} is now paid in full.`
        : `Recorded against ${data.invoice_no}.`,
    ),
    invoice: {
      id: data.id,
      invoice_no: data.invoice_no,
      grand_total: data.grand_total,
      status: data.status,
    },
  };
}

'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { cancelVisit } from '@/lib/rpc/visits';
import { reportActionError } from '@/lib/report-error';
import { cancelVisitSchema } from '@/lib/schemas/visit';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/utils/money';

/**
 * Front-desk actions that belong to the MODULE rather than to one screen.
 *
 * Cancelling is offered from the queue and from the incomplete list, which are
 * two views of the same board, so the action and its wording live in one place.
 */

/**
 * Cancel a visit, with a typed reason.
 *
 * queue.cancel rather than queue.manage. Transferring somebody moves them;
 * cancelling takes them off the board, retires a token a patient may be
 * holding a slip for, and voids a bill. A hospital that lets a nurse run the
 * queue may reasonably not want her doing that, and until this key existed it
 * could not say so.
 *
 * checkPermission, not requirePermission: a refusal belongs on the dialog as a
 * sentence rather than as Next.js's masked "unexpected error".
 *
 * Everything that decides whether the cancellation is ALLOWED -- the status,
 * the money, the void -- is in cancel_visit(), in one transaction.
 *
 * ON THE MONEY (20260923090000)
 *
 * queue.cancel alone is enough to cancel a visit and LEAVE a payment where it
 * is, because that moves no money: the invoice goes on recording cash that is
 * still in the drawer. That is the ordinary walk-out and it is the whole reason
 * the settlement argument exists -- registration collects the fee in the same
 * transaction that creates the visit, so every normally registered visit has a
 * paid invoice, and before this the desk could never complete a cancellation at
 * all.
 *
 * REFUNDING is a different act and needs billing.void, checked here. The
 * dialog hides the option from anybody without it, and that is decoration; this
 * is the boundary.
 */
export async function cancelVisitAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('queue.cancel');
  if (!gate.ok) return failure(gate.message);

  const parsed = cancelVisitSchema.safeParse({
    visit_id: formData.get('visit_id'),
    reason: formData.get('reason'),
    money: formData.get('money'),
  });
  if (!parsed.success) return invalid(parsed.error);

  if (parsed.data.money === 'refund') {
    const refundGate = await checkPermission('billing.void');
    if (!refundGate.ok) {
      return failure(
        'You are not allowed to refund a payment and void its bill. Cancel the visit ' +
          'keeping the payment, or ask the billing counter to refund it.',
      );
    }
  }

  const supabase = await createClient();

  const { data, error } = await cancelVisit(
    supabase,
    parsed.data.visit_id,
    parsed.data.reason,
    parsed.data.money,
  );

  if (error) {
    await reportActionError('cancelVisitAction', error);
    return failure(describeDatabaseError(error));
  }
  if (!data) return failure('The visit could not be cancelled. Nothing was changed.');

  refresh();

  return success(cancellationMessage(data));
}

/**
 * What the toast says, and it has to say what happened to the money.
 *
 * A clerk who has just cancelled a visit somebody paid for needs to read back
 * that the payment was kept -- that sentence is the difference between a
 * decision and a thing the software did.
 */
function cancellationMessage(result: {
  visit_no: string;
  token_no: number;
  invoices_voided: number;
  payments_retained: number;
}): string {
  const parts = [`${result.visit_no} cancelled.`];

  if (result.payments_retained > 0) {
    parts.push(`${formatMoney(result.payments_retained)} already collected was kept.`);
  }
  if (result.invoices_voided === 1) {
    parts.push('Its invoice was voided.');
  } else if (result.invoices_voided > 1) {
    parts.push(`${result.invoices_voided} invoices were voided.`);
  }

  parts.push(`Token ${result.token_no} is retired and will not be reissued.`);
  return parts.join(' ');
}

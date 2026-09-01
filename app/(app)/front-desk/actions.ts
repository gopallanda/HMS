'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { cancelVisit } from '@/lib/rpc/visits';
import { cancelVisitSchema } from '@/lib/schemas/visit';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

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
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await cancelVisit(supabase, parsed.data.visit_id, parsed.data.reason);

  if (error) return failure(describeDatabaseError(error));
  if (!data) return failure('The visit could not be cancelled. Nothing was changed.');

  refresh();

  return success(
    data.invoices_voided > 0
      ? `${data.visit_no} cancelled. ${data.invoices_voided === 1 ? 'Its unpaid invoice was' : `${data.invoices_voided} unpaid invoices were`} voided; token ${data.token_no} is retired.`
      : `${data.visit_no} cancelled. Token ${data.token_no} is retired and will not be reissued.`,
  );
}

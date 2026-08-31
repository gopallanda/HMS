'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { voidInvoice } from '@/lib/rpc/billing';
import { voidInvoiceSchema } from '@/lib/schemas/billing';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Void an invoice.
 *
 * Nothing is deleted (CLAUDE.md 3.2): void_invoice sets the status, keeps the
 * number consumed, releases the charge lines back to the visit so it can be
 * re-billed, and reverses the payments so the day-close report stops counting
 * money the hospital no longer has.
 *
 * The reason is typed, not confirmed (CLAUDE.md 7). It is validated here and
 * again inside the RPC, because a Server Action answers a POST and an RPC
 * answers a request -- neither is reachable only through the dialog.
 */
export async function voidInvoiceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('billing.void');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = voidInvoiceSchema.safeParse({
    invoice_id: formData.get('invoice_id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { error } = await voidInvoice(supabase, parsed.data.invoice_id, parsed.data.reason);
  if (error) return failure(describeDatabaseError(error));

  refresh();

  return success('The invoice was voided and its charges returned to the visit.');
}

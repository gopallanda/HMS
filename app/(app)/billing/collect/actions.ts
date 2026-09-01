'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import {
  ALREADY_BILLED,
  collectPayment,
  type CollectPaymentItem,
} from '@/lib/rpc/billing';
import { reportActionError } from '@/lib/report-error';
import { collectPaymentSchema } from '@/lib/schemas/billing';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export type CollectedInvoice = {
  id: string;
  invoice_no: string;
  grand_total: number;
  status: string;
};

export type CollectPaymentState = ActionState & {
  invoice?: CollectedInvoice;
  /**
   * Somebody else billed one of these charges while this screen was open.
   * Nothing was written -- the desk has to reload the visit and look again.
   */
  stale?: boolean;
};

/**
 * Take the money.
 *
 * Every rule that matters is enforced in collect_payment(), inside one
 * transaction (CLAUDE.md 3.2). This action validates early so the counter sees
 * a mistake before the round trip, checks the role because a Server Action
 * answers a POST without passing through any layout, and then gets out of the
 * way.
 */
export async function collectPaymentAction(
  _previous: CollectPaymentState,
  formData: FormData,
): Promise<CollectPaymentState> {
  const gate = await checkPermission('billing.collect');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = collectPaymentSchema.safeParse({
    invoice_id: formData.get('invoice_id'),
    visit_id: formData.get('visit_id'),
    items: formData.get('items'),
    mode: formData.get('mode'),
    amount: formData.get('amount'),
    reference: formData.get('reference'),
    discount: formData.get('discount'),
    discount_reason: formData.get('discount_reason'),
  });
  if (!parsed.success) return invalid(parsed.error);

  // The discount fields are wrapped in <Can permission="billing.discount"> on
  // the desk, and that is decoration. THIS is the check (CLAUDE.md 3.6): a
  // POST reaches this action without passing through the component that hid
  // the boxes, so a concession from somebody who may not give one is refused
  // here rather than banked and explained later.
  if (parsed.data.discount > 0) {
    const discountGate = await checkPermission('billing.discount');
    if (!discountGate.ok) return failure(discountGate.message);
  }

  // The `kind` discriminator is a form concern. What crosses the wire is the
  // shape collect_payment reads -- and notably NOT the tax rate, which the RPC
  // takes from the service master and never from the browser (CLAUDE.md 8).
  const items: CollectPaymentItem[] = parsed.data.items.map((line) =>
    line.kind === 'existing'
      ? { charge_item_id: line.charge_item_id }
      : {
          service_id: line.service_id,
          description: line.description,
          qty: line.qty,
          unit_price: line.unit_price,
        },
  );

  const supabase = await createClient();

  const { data, error } = await collectPayment(supabase, {
    invoiceId: parsed.data.invoice_id,
    visitId: parsed.data.visit_id,
    items,
    mode: parsed.data.mode,
    amount: parsed.data.amount,
    reference: parsed.data.reference,
    discount: parsed.data.discount,
    discountReason: parsed.data.discount_reason,
  });

  if (error) {
    if (error.code === ALREADY_BILLED) {
      return {
        status: 'error',
        message: error.message,
        stale: true,
      };
    }
    await reportActionError('collectPaymentAction', error);
    return failure(describeDatabaseError(error));
  }

  if (!data) return failure('The invoice could not be raised. Nothing was charged.');

  // The visit list on this screen is rendered on the server, and the visit
  // just billed no longer has anything pending on it.
  refresh();

  return {
    ...success(`${data.invoice_no} raised.`),
    invoice: {
      id: data.id,
      invoice_no: data.invoice_no,
      grand_total: data.grand_total,
      status: data.status,
    },
  };
}

'use server';

import { checkPermission } from '@/lib/auth/session';
import { isPrintFormat } from '@/lib/billing';
import { createClient } from '@/lib/supabase/server';

/**
 * Records that a receipt went to paper (block 5).
 *
 * Called from the browser rather than from the render, because a Server
 * Component runs again on every navigation and prefetch -- auditing there
 * would record prints nobody made and miss the second press of the Print
 * button, which is the one that matters. The print dialog opening is the
 * event, so the client reports it.
 *
 * Fire and forget on the caller's side. A failed audit write must never stop a
 * receipt reaching a patient standing at the counter; it is logged and the
 * paper still comes out.
 */
export async function recordReceiptPrint(invoiceId: string, format: string): Promise<void> {
  const gate = await checkPermission('billing.read');
  if (!gate.ok) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc('log_receipt_print', {
    p_invoice_id: invoiceId,
    p_format: isPrintFormat(format) ? format : 'unknown',
  });

  if (error) {
    console.error('receipt print audit failed', { invoiceId, message: error.message });
  }
}

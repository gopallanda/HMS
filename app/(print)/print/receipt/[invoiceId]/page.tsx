import { notFound } from 'next/navigation';

import { PrintAudit } from './print-audit';
import { ReceiptSheet } from './receipt-sheet';
import { A4Invoice } from './a4-invoice';
import type { InvoiceDocument } from './document';
import { PrintLayout } from '@/components/shared/print-layout';
import { AccessDenied } from '@/components/shell/access-denied';
import { defaultPrintFormat, isPrintFormat, type PrintFormat } from '@/lib/billing';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Receipt' };

/**
 * The one print route (block 5, and block 7.3).
 *
 * It replaced /print/invoice/[id], which did the same job with a different
 * name and no auto-print. Two routes rendering one document is two places for
 * a change to the paper to be forgotten, and the earlier one was reachable
 * only from links this codebase owns -- so it went rather than being kept as a
 * redirect nobody would ever delete.
 *
 * This is the paper a patient is handed thirty seconds after they paid, so it
 * opens the print dialog on arrival and leads with the token rather than the
 * invoice number. Three papers, one document: 80mm and A5 share ReceiptSheet,
 * A4 renders the full invoice for anything leaving the building.
 *
 * `?autoprint=0` turns that off, for the one case where it is wrong: somebody
 * reprinting from the invoice list who wants to check they have the right bill
 * before spending a roll on it.
 *
 * Permission is billing.read, not a role name (CLAUDE.md 3.6). Reception holds
 * it, which is the whole point -- the clerk who just took three hundred rupees
 * has to be able to print the receipt for it.
 */
export default async function ReceiptPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ format?: string; autoprint?: string }>;
}) {
  const session = await requireSession();
  const { invoiceId } = await params;
  const { format: requested, autoprint } = await searchParams;

  if (!session.access.permissions.has('billing.read')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="Receipts"
        audience="the front desk and billing staff"
      />
    );
  }

  const supabase = await createClient();

  const [invoiceResult, lineResult, paymentResult] = await Promise.all([
    supabase
      .from('invoice_summary')
      .select(
        'id, invoice_no, invoice_date, status, void_reason, subtotal, tax_total, grand_total, paid_total, balance, patient_name_snapshot, patient_mrn, patient_phone, visit_no, token_no, doctor_name, department_name, created_by_name',
      )
      .eq('hospital_id', session.hospitalId)
      .eq('id', invoiceId)
      .maybeSingle(),
    supabase
      .from('charge_items')
      .select('id, description, qty, unit_price, amount, tax_rate')
      .eq('hospital_id', session.hospitalId)
      .eq('invoice_id', invoiceId)
      .order('created_at'),
    supabase
      .from('payments')
      .select('id, amount, mode, reference, paid_at, is_reversed')
      .eq('hospital_id', session.hospitalId)
      .eq('invoice_id', invoiceId)
      .order('paid_at'),
  ]);

  if (invoiceResult.error || !invoiceResult.data) notFound();

  const document: InvoiceDocument = {
    // Name, logo, address and GSTIN come from the hospitals row, never
    // hardcoded (CLAUDE.md 7). requireSession already loaded it.
    hospital: {
      name: session.hospital.name,
      logo_url: session.hospital.logo_url,
      address: session.hospital.address,
      phone: session.hospital.phone,
      gstin: session.hospital.gstin,
    },
    invoice: invoiceResult.data,
    lines: lineResult.data ?? [],
    payments: paymentResult.data ?? [],
  };

  // The paper the hospital chose under Settings -> Printing, unless the URL
  // says otherwise. Thermal is the fallback: it is what is loaded in the
  // printer at an OPD counter (CLAUDE.md 7).
  const format: PrintFormat = isPrintFormat(requested)
    ? requested
    : defaultPrintFormat(session.hospital.settings);

  return (
    <PrintLayout
      format={format}
      autoPrint={autoprint !== '0'}
      backHref="/front-desk/queue"
      documentHref={`/print/receipt/${invoiceId}`}
      title={`Receipt ${document.invoice.invoice_no} - ${document.invoice.patient_name_snapshot}`}
    >
      <PrintAudit invoiceId={invoiceId} format={format} />
      {/* A4 is a full invoice, so it keeps the invoice template. Thermal and
          A5 are the same receipt on different paper. */}
      {format === 'a4' ? <A4Invoice document={document} /> : <ReceiptSheet document={document} />}
    </PrintLayout>
  );
}

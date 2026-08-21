import { notFound } from 'next/navigation';

import { A4Invoice } from './a4-invoice';
import { ThermalReceipt } from './thermal-receipt';
import { PrintLayout } from '@/components/shared/print-layout';
import { AccessDenied } from '@/components/shell/access-denied';
import { defaultPrintFormat, isPrintFormat, type PrintFormat } from '@/lib/billing';
import { requireSession } from '@/lib/auth/session';
import { isBillingRole } from '@/lib/roles';
import type { InvoiceSummaryRow } from '@/lib/rpc/billing';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Invoice' };

/** Everything both templates print. One query set, two papers (CLAUDE.md 7). */
export type InvoiceDocument = {
  hospital: {
    name: string;
    logo_url: string | null;
    address: string | null;
    phone: string | null;
    gstin: string | null;
  };
  invoice: Pick<
    InvoiceSummaryRow,
    | 'id'
    | 'invoice_no'
    | 'invoice_date'
    | 'status'
    | 'void_reason'
    | 'subtotal'
    | 'tax_total'
    | 'grand_total'
    | 'paid_total'
    | 'balance'
    | 'patient_name_snapshot'
    | 'patient_mrn'
    | 'patient_phone'
    | 'visit_no'
    | 'token_no'
    | 'doctor_name'
    | 'department_name'
    | 'created_by_name'
  >;
  lines: {
    id: string;
    description: string;
    qty: number;
    unit_price: number;
    amount: number;
    tax_rate: number;
  }[];
  payments: {
    id: string;
    amount: number;
    mode: 'cash' | 'upi' | 'card' | 'other';
    reference: string | null;
    paid_at: string;
    is_reversed: boolean;
  }[];
};

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string; autoprint?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { format: requested, autoprint } = await searchParams;

  if (!isBillingRole(session.role)) {
    return <AccessDenied role={session.role} area="Invoices" audience="billing staff" />;
  }

  const supabase = await createClient();

  const [invoiceResult, lineResult, paymentResult] = await Promise.all([
    supabase
      .from('invoice_summary')
      .select(
        'id, invoice_no, invoice_date, status, void_reason, subtotal, tax_total, grand_total, paid_total, balance, patient_name_snapshot, patient_mrn, patient_phone, visit_no, token_no, doctor_name, department_name, created_by_name',
      )
      .eq('hospital_id', session.hospitalId)
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('charge_items')
      .select('id, description, qty, unit_price, amount, tax_rate')
      .eq('hospital_id', session.hospitalId)
      .eq('invoice_id', id)
      .order('created_at'),
    supabase
      .from('payments')
      .select('id, amount, mode, reference, paid_at, is_reversed')
      .eq('hospital_id', session.hospitalId)
      .eq('invoice_id', id)
      .order('paid_at'),
  ]);

  if (invoiceResult.error || !invoiceResult.data) notFound();

  const document: InvoiceDocument = {
    // Hospital name, logo, address and GSTIN come from the hospitals row, never
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

  // The format the hospital's printer is loaded with, unless the URL says
  // otherwise. Thermal is the default for OPD receipts (CLAUDE.md 7).
  const format: PrintFormat = isPrintFormat(requested)
    ? requested
    : defaultPrintFormat(session.hospital.settings);

  return (
    <PrintLayout
      format={format}
      autoPrint={autoprint === '1'}
      backHref="/billing/collect"
      documentHref={`/print/invoice/${id}`}
      title={`${document.invoice.invoice_no} - ${document.invoice.patient_name_snapshot}`}
    >
      {format === 'thermal' ? (
        <ThermalReceipt document={document} />
      ) : (
        <A4Invoice document={document} />
      )}
    </PrintLayout>
  );
}

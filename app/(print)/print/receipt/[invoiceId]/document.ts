import type { InvoiceSummaryRow } from '@/lib/rpc/billing';

/**
 * Everything a printed bill needs, whichever paper it lands on.
 *
 * One query set, three papers (CLAUDE.md 7): the 80mm roll and the A5 sheet
 * share ReceiptSheet, and A4 renders the full invoice. Nothing downstream
 * computes a total -- every figure here is what collect_payment stored.
 *
 * It lives in its own module because both templates and the page import it,
 * and a type exported from a `page.tsx` drags the whole route into anything
 * that touches it.
 */
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

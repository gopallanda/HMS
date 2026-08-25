import Link from 'next/link';

import { InvoiceTable, type InvoiceRowData } from './invoice-table';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { INVOICE_STATUSES, INVOICE_STATUS_LABEL, type InvoiceStatus } from '@/lib/billing';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayIst } from '@/lib/utils/dates';
import { formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Invoices' };

function isStatus(value: string | undefined): value is InvoiceStatus {
  return value !== undefined && (INVOICE_STATUSES as readonly string[]).includes(value);
}

/**
 * The invoice book.
 *
 * Opens on today, because the question at a billing counter is almost always
 * about a bill raised in the last few hours. The filters are a plain GET form:
 * no client state, the URL is the state, and a filtered list can be
 * bookmarked or handed to somebody else.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; status?: string; q?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const { day, status, q } = await searchParams;

  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day! : todayIst();
  const search = (q ?? '').trim();

  let query = supabase
    .from('invoice_summary')
    .select(
      'id, invoice_no, invoice_date, status, void_reason, subtotal, tax_total, grand_total, paid_total, balance, patient_name_snapshot, patient_mrn, visit_no, token_no, doctor_name, department_name, payment_modes, created_by_name',
    )
    .eq('hospital_id', session.hospitalId);

  // A search looks across the whole book; without one the list is one day.
  // Somebody hunting for a bill from last Tuesday knows the name, not the date.
  if (search === '') {
    query = query.eq('invoice_day', selectedDay);
  } else {
    const pattern = `%${search}%`;
    query = query.or(
      `invoice_no.ilike.${pattern},patient_name_snapshot.ilike.${pattern},patient_mrn.ilike.${pattern},visit_no.ilike.${pattern}`,
    );
  }

  if (isStatus(status)) query = query.eq('status', status);

  const { data, error } = await query.order('invoice_date', { ascending: false }).limit(200);

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Invoices" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The invoice list could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  const invoices: InvoiceRowData[] = data ?? [];

  // Totals for what is on screen, not for the hospital. The day-close report is
  // the authority on a day; this is an orientation line.
  const billed = invoices
    .filter((invoice) => invoice.status !== 'void')
    .reduce((sum, invoice) => sum + invoice.grand_total, 0);
  const collected = invoices.reduce((sum, invoice) => sum + invoice.paid_total, 0);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Invoices"
        description={
          search === ''
            ? `${formatDate(selectedDay)} \u00b7 ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}, ${formatMoney(billed)} billed, ${formatMoney(collected)} collected`
            : `${invoices.length} match${invoices.length === 1 ? '' : 'es'} across all dates`
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/billing/collect">Collect payment</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/billing/day-close?day=${selectedDay}`}>Day close</Link>
            </Button>
          </>
        }
      />

      {/* A GET form: Enter in any field applies the filters, and the browser
          does the navigation. Nothing here needs JavaScript. */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm md:p-4">
        <label className="grid flex-1 gap-1.5 sm:flex-none">
          <span className="text-sm font-medium">Day</span>
          <Input type="date" name="day" defaultValue={selectedDay} className="w-full sm:w-44" />
        </label>

        <label className="grid flex-1 gap-1.5 sm:flex-none">
          <span className="text-sm font-medium">Status</span>
          {/* A native select, not the Radix one: this form is a plain GET and
              submits without JavaScript, which a controlled listbox would not. */}
          <select
            name="status"
            defaultValue={isStatus(status) ? status : ''}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:px-2.5"
          >
            <option value="">All</option>
            {INVOICE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {INVOICE_STATUS_LABEL[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid min-w-0 flex-1 gap-1.5">
          <span className="text-sm font-medium">Invoice no, patient, MRN or visit</span>
          <Input
            name="q"
            defaultValue={search}
            placeholder="INV/2026-27/00042"
            className="w-full"
            autoComplete="off"
          />
        </label>

        <div className="flex items-center gap-2">
          <Button type="submit">Apply</Button>
          {search !== '' || isStatus(status) ? (
            <Button asChild variant="ghost">
              <Link href="/billing/invoices">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <p className="-mt-2 text-xs text-muted-foreground">
        A search looks across every date; leave it empty to stay on one day.
      </p>

      <InvoiceTable invoices={invoices} />
    </div>
  );
}

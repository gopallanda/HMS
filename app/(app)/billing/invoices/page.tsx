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
      <div className="grid gap-4">
        <PageHeader title="Invoices" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
    <div className="grid gap-3">
      <PageHeader
        title="Invoices"
        description={
          search === ''
            ? `${formatDate(selectedDay)} - ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}, ${formatMoney(billed)} billed, ${formatMoney(collected)} collected`
            : `${invoices.length} match${invoices.length === 1 ? '' : 'es'} across all dates`
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/billing/collect">Collect payment</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/billing/day-close?day=${selectedDay}`}>Day close</Link>
            </Button>
          </>
        }
      />

      {/* A GET form: Enter in any field applies the filters, and the browser
          does the navigation. Nothing here needs JavaScript. */}
      <form className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
        <label className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">Day</span>
          <Input type="date" name="day" defaultValue={selectedDay} className="h-8 w-40" />
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={isStatus(status) ? status : ''}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">All</option>
            {INVOICE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {INVOICE_STATUS_LABEL[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">
            Invoice no, patient, MRN or visit - searches every day
          </span>
          <Input
            name="q"
            defaultValue={search}
            placeholder="INV/2026-27/00042"
            className="h-8 w-72"
            autoComplete="off"
          />
        </label>

        <Button type="submit" size="sm">
          Apply
        </Button>
        {search !== '' || isStatus(status) ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/billing/invoices">Clear</Link>
          </Button>
        ) : null}
      </form>

      <InvoiceTable invoices={invoices} />
    </div>
  );
}

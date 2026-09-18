import Link from 'next/link';

import { InvoiceTable, type InvoiceRowData } from './invoice-table';
import type { InvoicePayment } from './payments-dialog';
import { Notice } from '@/components/shared/form-message';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
      'id, invoice_no, invoice_date, status, void_reason, subtotal, tax_total, grand_total, paid_total, balance, patient_id, patient_name_snapshot, patient_mrn, visit_no, token_no, doctor_name, department_name, payment_modes, created_by_name',
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

  // The cap is real and the screen says so below rather than quietly dropping
  // the tail (block 9). One row over the limit is fetched purely to find out
  // whether there IS a tail; it is sliced off before anything renders.
  const LIST_LIMIT = 200;

  // The staff name map is fetched ALONGSIDE the invoice list rather than after
  // the payments read that needs it. It does not depend on either, it is one
  // small per-hospital table, and every round trip on this page costs the
  // latency between the function and Postgres -- so a lookup that can start at
  // t=0 should not be the third leg of a waterfall.
  const [{ data, error }, staffResult] = await Promise.all([
    query.order('invoice_date', { ascending: false }).limit(LIST_LIMIT + 1),
    supabase
      .from('staff')
      .select('user_id, full_name')
      .eq('hospital_id', session.hospitalId)
      .not('user_id', 'is', null),
  ]);

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Invoices" />
        <p className="rounded-xl bg-destructive/10 px-3.5 py-3 text-sm text-destructive md:rounded-lg md:px-3 md:py-2.5">
          The invoice list could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  const fetched: InvoiceRowData[] = data ?? [];
  const capped = fetched.length > LIST_LIMIT;
  const invoices: InvoiceRowData[] = capped ? fetched.slice(0, LIST_LIMIT) : fetched;

  // ---------------------------------------------------------------------------
  // The payments behind each bill.
  //
  // Fetched here rather than joined into invoice_summary, which aggregates
  // them: reversing needs a payment ID, a mode and a reference per ROW, and
  // the view deliberately hands back a total and a set of mode labels. Only
  // for the invoices on screen, and only when the viewer may read money at
  // all -- for anyone else the policies return nothing and the row simply has
  // no Payments button.
  //
  // Collector names come from the staff map fetched above rather than a join,
  // because payments.collected_by points at auth.users and the name lives on
  // staff.
  // ---------------------------------------------------------------------------
  const payments: Record<string, InvoicePayment[]> = {};

  if (invoices.length > 0) {
    const { data: rows } = await supabase
      .from('payments')
      .select('id, invoice_id, amount, mode, reference, paid_at, is_reversed, reversal_reason, collected_by')
      .eq('hospital_id', session.hospitalId)
      .in(
        'invoice_id',
        invoices.map((invoice) => invoice.id),
      )
      .order('paid_at', { ascending: true });

    const names = new Map<string, string>();
    for (const person of staffResult.data ?? []) {
      if (person.user_id) names.set(person.user_id, person.full_name);
    }

    for (const row of rows ?? []) {
      (payments[row.invoice_id] ??= []).push({
        id: row.id,
        amount: row.amount,
        mode: row.mode,
        reference: row.reference,
        paid_at: row.paid_at,
        is_reversed: row.is_reversed,
        reversal_reason: row.reversal_reason,
        collected_by_name: names.get(row.collected_by) ?? null,
      });
    }
  }

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
      <form className="grid grid-cols-2 items-end gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm md:flex md:flex-wrap md:rounded-xl md:p-4">
        <div className="grid gap-1.5 md:flex-none">
          <span className="text-sm font-medium">Day</span>
          <DatePicker name="day" defaultValue={selectedDay} className="w-full md:w-44" />
        </div>

        <div className="grid gap-1.5 md:flex-none">
          <span className="text-sm font-medium">Status</span>
          {/* Radix renders a hidden native <select> for a named Select inside a
              form, so this GET form still posts `status` like the plain one
              did. "all" is not a status, which the page reads as no filter. */}
          <Select name="status" defaultValue={isStatus(status) ? status : 'all'}>
            <SelectTrigger className="w-full md:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">All statuses</SelectItem>
              {INVOICE_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {INVOICE_STATUS_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="col-span-2 grid min-w-0 flex-1 gap-1.5">
          <span className="text-sm font-medium">Invoice no, patient, MRN or visit</span>
          <Input
            name="q"
            defaultValue={search}
            placeholder="INV/2026-27/00042"
            className="w-full"
            autoComplete="off"
          />
        </label>

        <div className="col-span-2 flex items-center gap-2 max-md:*:flex-1">
          <Button type="submit">Apply</Button>
          {search !== '' || isStatus(status) ? (
            <Button asChild variant="ghost">
              <Link href="/billing/invoices">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <p className="-mt-2 px-1 text-xs text-muted-foreground md:px-0">
        A search looks across every date; leave it empty to stay on one day.
      </p>

      {capped ? (
        <Notice>
          Showing the {LIST_LIMIT} most recent of more than {LIST_LIMIT} matching invoices. The
          totals above are for these {LIST_LIMIT} only. Narrow the search, or pick a single day,
          to see the rest.
        </Notice>
      ) : null}

      <InvoiceTable
        invoices={invoices}
        canCollect={session.access.permissions.has('billing.collect')}
        canVoid={session.access.permissions.has('billing.void')}
        payments={payments}
      />
    </div>
  );
}

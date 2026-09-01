import Link from 'next/link';

import { DuesTable, type DueRow } from './dues-table';
import { Notice } from '@/components/shared/form-message';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireSession } from '@/lib/auth/session';
import { AGE_BUCKETS, bucketFor } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { createClient } from '@/lib/supabase/server';
import { todayIst } from '@/lib/utils/dates';
import { formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Outstanding dues' };

/**
 * How many rows come back at once.
 *
 * A cap, and one the screen admits to below rather than a silent slice. A
 * hospital with more than this outstanding has a collections problem no list
 * is going to solve; the search box is what narrows it.
 */
const LIST_LIMIT = 500;

/** Whole IST days between an invoice date and today. Never negative. */
function ageInDays(invoiceDate: string, today: string): number {
  const from = Date.parse(`${invoiceDate.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Who owes the hospital money.
 *
 * /billing/invoices opens on a single day, which is right for a counter and
 * useless for the first question an owner asks. This is the other view of the
 * same rows: every non-void invoice with a balance, across all dates, newest
 * first, with the phone number beside it because chasing a debt at a small
 * hospital is a phone call.
 *
 * Read-only apart from the collect dialog. Nothing here recomputes a balance:
 * invoice_summary.balance is grand_total minus non-reversed payments, which is
 * the same arithmetic add_payment uses under a row lock.
 */
export default async function DuesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; bucket?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const { q, bucket } = await searchParams;

  const today = todayIst();
  const search = (q ?? '').trim();
  const selectedBucket = AGE_BUCKETS.find((option) => option.key === bucket)?.key ?? null;

  let query = supabase
    .from('invoice_summary')
    .select(
      'id, invoice_no, invoice_date, status, grand_total, paid_total, balance, patient_id, patient_name_snapshot, patient_mrn, patient_phone',
    )
    .eq('hospital_id', session.hospitalId)
    // Void invoices carry no balance worth chasing: the number stays consumed
    // and the charges went back to the visit (CLAUDE.md 3.2).
    .in('status', ['unpaid', 'partial'])
    .gt('balance', 0);

  if (search !== '') {
    const pattern = `%${search}%`;
    query = query.or(
      `invoice_no.ilike.${pattern},patient_name_snapshot.ilike.${pattern},patient_mrn.ilike.${pattern},patient_phone.ilike.${pattern}`,
    );
  }

  const { data, error } = await query
    .order('invoice_date', { ascending: false })
    .limit(LIST_LIMIT + 1);

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Outstanding dues" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The dues list could not be loaded, so no total is shown rather than a wrong one:{' '}
          {error.message}
        </p>
      </div>
    );
  }

  const fetched = data ?? [];
  const capped = fetched.length > LIST_LIMIT;

  const rows: DueRow[] = (capped ? fetched.slice(0, LIST_LIMIT) : fetched).map((row) => ({
    ...row,
    age_days: ageInDays(row.invoice_date, today),
  }));

  const visible = selectedBucket
    ? rows.filter((row) => bucketFor(row.age_days) === selectedBucket)
    : rows;

  const total = visible.reduce((sum, row) => sum + row.balance, 0);

  // The buckets are counted over EVERYTHING fetched, not over the filtered
  // view: the point of the chips is to show what is behind them before
  // somebody clicks one.
  const byBucket = AGE_BUCKETS.map((option) => {
    const inBucket = rows.filter((row) => bucketFor(row.age_days) === option.key);
    return {
      ...option,
      count: inBucket.length,
      amount: inBucket.reduce((sum, row) => sum + row.balance, 0),
    };
  });

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Outstanding dues"
        description={`${visible.length} invoice${visible.length === 1 ? '' : 's'} owing ${formatMoney(total)} across all dates`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/billing/invoices">Invoices</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/billing/day-close">Day close</Link>
            </Button>
          </>
        }
      />

      {/* The three buckets, as filter chips carrying their own totals. A plain
          GET like the invoice filters: the URL is the state, so a list of the
          31-day debts can be bookmarked or sent to somebody. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {byBucket.map((option) => (
          <Link
            key={option.key}
            href={
              selectedBucket === option.key
                ? `/billing/dues${search === '' ? '' : `?q=${encodeURIComponent(search)}`}`
                : `/billing/dues?bucket=${option.key}${search === '' ? '' : `&q=${encodeURIComponent(search)}`}`
            }
            className={cn(
              'rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-colors hover:border-ring/60',
              selectedBucket === option.key && 'border-primary ring-1 ring-primary/40',
              option.key === 'old' && option.amount > 0 && 'border-l-4 border-l-destructive',
            )}
          >
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {option.label}
            </p>
            <p className="mt-1.5 text-2xl leading-none font-bold tracking-tight tabular-nums">
              {formatMoney(option.amount)}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {option.count} invoice{option.count === 1 ? '' : 's'}
              {selectedBucket === option.key ? ' · showing' : ''}
            </p>
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm md:p-4">
        {selectedBucket ? (
          <input type="hidden" name="bucket" value={selectedBucket} />
        ) : null}
        <label className="grid min-w-0 flex-1 gap-1.5">
          <span className="text-sm font-medium">Patient, MRN, phone or invoice no</span>
          <Input
            name="q"
            defaultValue={search}
            placeholder="98860 22113"
            className="w-full"
            autoComplete="off"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit">Search</Button>
          {search !== '' || selectedBucket ? (
            <Button asChild variant="ghost">
              <Link href="/billing/dues">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {capped ? (
        <Notice>
          Showing the {LIST_LIMIT} most recent of more than {LIST_LIMIT} outstanding invoices.
          The totals above are for these {LIST_LIMIT} only. Search to narrow the list.
        </Notice>
      ) : null}

      <DuesTable
        rows={visible}
        canCollect={session.access.permissions.has('billing.collect')}
      />

      <p className="text-xs text-muted-foreground">
        Voided invoices are not here: the number stays consumed but the charges went back to the
        visit, so nothing is owed. Age is counted in IST days from the invoice date.
      </p>
    </div>
  );
}

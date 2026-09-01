import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

import { ClosePanel, type DayClosure } from './close-panel';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireSession } from '@/lib/auth/session';
import { PAYMENT_MODE_LABEL, type PaymentMode } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { dayCloseReport, groupDayClose, type DayCloseRow } from '@/lib/rpc/billing';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayIst } from '@/lib/utils/dates';
import { formatAmount, formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Day close' };

/** One IST day either side, for the arrows. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Day close.
 *
 * What the cashier reads out while counting the drawer: everything collected
 * today, split three ways. Read-only -- closing a day is a conversation
 * between a person and a cash box, and this system's job is to say what it
 * recorded, not to lock anything.
 *
 * One RPC call, so every section comes from the same snapshot. Reversed
 * payments are already excluded by day_close_report: a voided bill is not
 * money in the drawer.
 */
export default async function DayClosePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const { day } = await searchParams;

  const today = todayIst();
  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day! : today;

  // The report and the closure for this day, together. The closure is a plain
  // read through day_closures_select_tenant -- close_day() is the only writer.
  const [{ data, error }, closureResult] = await Promise.all([
    dayCloseReport(supabase, session.hospitalId, selectedDay),
    supabase
      .from('day_closures')
      .select('declared_cash, system_cash, variance, notes, closed_at, closed_by')
      .eq('hospital_id', session.hospitalId)
      .eq('close_date', selectedDay)
      .maybeSingle(),
  ]);

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Day close" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The report could not be run: {error.message}
        </p>
      </div>
    );
  }

  const report = groupDayClose((data ?? []) as DayCloseRow[]);
  const collected = report.collected?.amount ?? 0;
  const discounted = report.discounted?.amount ?? 0;

  // What the drawer should hold. Card and UPI settle into a bank account, so
  // the cash line is the only one a hand count can disagree with.
  const systemCash =
    report.byMode.find((row) => row.key === 'cash')?.amount ?? 0;

  let closure: DayClosure | null = null;

  if (closureResult.data) {
    // Who closed it, by name. A second small read rather than a join, because
    // closed_by points at auth.users and the name lives on staff -- the same
    // shape invoice_summary uses for created_by_name.
    const { data: closer } = closureResult.data.closed_by
      ? await supabase
          .from('staff')
          .select('full_name')
          .eq('hospital_id', session.hospitalId)
          .eq('user_id', closureResult.data.closed_by)
          .maybeSingle()
      : { data: null };

    closure = {
      declared_cash: closureResult.data.declared_cash,
      system_cash: closureResult.data.system_cash,
      variance: closureResult.data.variance,
      notes: closureResult.data.notes,
      closed_at: closureResult.data.closed_at,
      closed_by_name: closer?.full_name ?? null,
    };
  }

  const atToday = selectedDay >= today;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Day close"
        description={`${formatDate(selectedDay)}${selectedDay === today ? ' \u00b7 today, still open' : ''}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/billing/invoices?day=${selectedDay}`}>Invoices</Link>
          </Button>
        }
      />

      {/* Day navigation. The arrows and the picker are one control group: a
          cashier reconciling a week walks it a day at a time, and somebody
          answering a query about last month types the date. */}
      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" aria-label="Previous day">
            <Link href={`/billing/day-close?day=${shiftDay(selectedDay, -1)}`}>
              <ChevronLeftIcon />
            </Link>
          </Button>
          {atToday ? (
            <Button variant="outline" size="icon" disabled aria-label="Next day">
              <ChevronRightIcon />
            </Button>
          ) : (
            <Button asChild variant="outline" size="icon" aria-label="Next day">
              <Link href={`/billing/day-close?day=${shiftDay(selectedDay, 1)}`}>
                <ChevronRightIcon />
              </Link>
            </Button>
          )}
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Day (IST)</span>
          <Input type="date" name="day" defaultValue={selectedDay} max={today} className="w-44" />
        </label>
        <Button type="submit">Run</Button>
      </form>

      {/* The three numbers somebody actually reads out. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary
          label="Collected"
          value={collected}
          note={`${report.collected?.entry_count ?? 0} payment${report.collected?.entry_count === 1 ? '' : 's'}`}
          strong
        />
        <Summary
          label="Billed"
          value={report.invoiced?.amount ?? 0}
          note={`${report.invoiced?.entry_count ?? 0} invoice${report.invoiced?.entry_count === 1 ? '' : 's'} raised`}
        />
        <Summary
          label="Voided"
          value={report.voided?.amount ?? 0}
          note={`${report.voided?.entry_count ?? 0} cancelled, payments reversed`}
        />
        {/* Leakage, beside the collections rather than in a report nobody
            opens. "We took 41,000" is not a day anybody can reconcile without
            "and gave away 2,300" next to it (item 5). */}
        <Summary
          label="Concessions"
          value={discounted}
          note={`given on ${report.discounted?.entry_count ?? 0} bill${report.discounted?.entry_count === 1 ? '' : 's'}`}
        />
      </div>

      <ClosePanel
        date={selectedDay}
        systemCash={systemCash}
        closure={closure}
        canClose={session.access.permissions.has('reports.view')}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title="By payment mode"
          caption="What should be in the drawer, and what should have settled."
          rows={report.byMode.map((row) => ({
            key: row.key,
            label: PAYMENT_MODE_LABEL[row.key as PaymentMode] ?? row.label,
            count: row.entry_count,
            amount: row.amount,
          }))}
          total={collected}
        />

        <Section
          title="By staff"
          caption="Who took it. This is the handover list at the end of a shift."
          rows={report.byStaff.map((row) => ({
            key: row.key,
            label: row.label,
            count: row.entry_count,
            amount: row.amount,
          }))}
          total={collected}
          empty="Nobody collected anything on this day."
        />

        <Section
          title="By department"
          caption="Where the work was done, from the visit on each invoice."
          rows={report.byDepartment.map((row) => ({
            key: row.key,
            label: row.label,
            count: row.entry_count,
            amount: row.amount,
          }))}
          total={collected}
          empty="No collections to attribute."
        />
      </div>

      <p className="text-xs text-muted-foreground">
        The day is the IST calendar day, not the server&apos;s. Reversed payments are excluded
        everywhere on this page, so a bill voided after it was paid leaves no money behind in
        these totals.
      </p>
    </div>
  );
}

/**
 * One headline figure.
 *
 * `strong` marks the drawer total -- the only one of the three that is counted
 * against physical cash, so it carries the accent rule and the heavier weight
 * while billed and voided stay quiet beside it.
 */
function Summary({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: number;
  note: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-card p-4 shadow-sm md:p-5',
        strong && 'border-l-4 border-l-primary',
      )}
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          'mt-1.5 leading-none tabular-nums',
          strong
            ? 'text-3xl font-bold tracking-tight text-primary'
            : 'text-2xl font-semibold text-foreground/80',
        )}
      >
        {formatMoney(value)}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Section({
  title,
  caption,
  rows,
  total,
  empty = 'Nothing here.',
}: {
  title: string;
  caption: string;
  rows: { key: string; label: string; count: number; amount: number }[];
  total: number;
  empty?: string;
}) {
  return (
    <section className="grid content-start gap-2">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="w-14 text-right">No.</TableHead>
              <TableHead className="w-28 text-right">Amount &#8377;</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key} className="even:bg-muted/25">
                  <TableCell className="truncate">{row.label}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {row.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(row.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
            {rows.length > 0 ? (
              <TableRow className="border-t-2 border-t-border bg-muted/40 hover:bg-muted/40">
                <TableCell className="font-medium">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatAmount(total)}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

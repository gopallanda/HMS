import Link from 'next/link';

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

  const { data, error } = await dayCloseReport(supabase, session.hospitalId, selectedDay);

  if (error) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Day close" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The report could not be run: {error.message}
        </p>
      </div>
    );
  }

  const report = groupDayClose((data ?? []) as DayCloseRow[]);
  const collected = report.collected?.amount ?? 0;

  return (
    <div className="grid gap-3">
      <PageHeader
        title="Day close"
        description={`${formatDate(selectedDay)}${selectedDay === today ? ' - today, still open' : ''}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/billing/day-close?day=${shiftDay(selectedDay, -1)}`}>
                &larr; Previous
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={selectedDay >= today}>
              <Link href={`/billing/day-close?day=${shiftDay(selectedDay, 1)}`}>Next &rarr;</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/billing/invoices?day=${selectedDay}`}>Invoices</Link>
            </Button>
          </>
        }
      />

      <form className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
        <label className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">Day (IST)</span>
          <Input type="date" name="day" defaultValue={selectedDay} max={today} className="h-8 w-40" />
        </label>
        <Button type="submit" size="sm">
          Run
        </Button>
      </form>

      {/* The three numbers somebody actually reads out. */}
      <div className="grid gap-2 sm:grid-cols-3">
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
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
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

      <p className="text-[11px] text-muted-foreground">
        The day is the IST calendar day, not the server&apos;s. Reversed payments are excluded
        everywhere on this page, so a bill voided after it was paid leaves no money behind in
        these totals.
      </p>
    </div>
  );
}

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
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          strong
            ? 'text-2xl font-semibold tabular-nums'
            : 'text-xl font-medium tabular-nums text-muted-foreground'
        }
      >
        {formatMoney(value)}
      </p>
      <p className="text-[11px] text-muted-foreground">{note}</p>
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
    <section className="grid content-start gap-1.5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-[11px] text-muted-foreground">{caption}</p>
      </div>

      <div className="rounded-lg border">
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
                <TableRow key={row.key}>
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
              <TableRow className="border-t-2">
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

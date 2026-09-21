import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

import { ClosePanel, type DayClosure } from './close-panel';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import { SERVICE_CATEGORY_LABEL, type ServiceCategory } from '@/lib/services';
import { createClient } from '@/lib/supabase/server';
import { formatDate, shiftIstDay, todayIst } from '@/lib/utils/dates';
import { formatAmount, formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Day close' };

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
  //
  // The staff name map rides along too. Naming whoever closed the day needs
  // it, but that need is only discovered AFTER the closure row comes back --
  // and waiting to find out costs a whole extra round trip to Mumbai on a
  // screen a cashier walks a day at a time with the arrow buttons. The table
  // is a few dozen rows per hospital.
  const [{ data, error }, closureResult, staffResult] = await Promise.all([
    dayCloseReport(supabase, session.hospitalId, selectedDay),
    supabase
      .from('day_closures')
      .select('declared_cash, system_cash, variance, notes, closed_at, closed_by')
      .eq('hospital_id', session.hospitalId)
      .eq('close_date', selectedDay)
      .maybeSingle(),
    supabase
      .from('staff')
      .select('user_id, full_name')
      .eq('hospital_id', session.hospitalId)
      .not('user_id', 'is', null),
  ]);

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Day close" />
        <p className="rounded-xl bg-destructive/10 px-3.5 py-3 text-sm text-destructive md:rounded-lg md:px-3 md:py-2.5">
          The report could not be run: {error.message}
        </p>
      </div>
    );
  }

  const report = groupDayClose((data ?? []) as DayCloseRow[]);
  const collected = report.collected?.amount ?? 0;
  const discounted = report.discounted?.amount ?? 0;
  const billed = report.invoiced?.amount ?? 0;
  const tax = report.tax?.amount ?? 0;

  // What the day was made of, and the arithmetic that ties it to the Billed
  // card above. Printed rather than assumed: the service section counts charge
  // LINES on bills raised today, which is a different population from the
  // payments every other section counts, and a table that silently fails to
  // match the headline is worse than no table.
  const chargesTotal = report.byService.reduce((sum, row) => sum + row.amount, 0);
  const bridgeBalances = Math.abs(chargesTotal + tax - discounted - billed) < 0.01;

  // What the drawer should hold. Card and UPI settle into a bank account, so
  // the cash line is the only one a hand count can disagree with.
  const systemCash =
    report.byMode.find((row) => row.key === 'cash')?.amount ?? 0;

  let closure: DayClosure | null = null;

  if (closureResult.data) {
    // Who closed it, by name. Resolved from the map fetched above rather than
    // a join, because closed_by points at auth.users and the name lives on
    // staff -- the same shape invoice_summary uses for created_by_name.
    const closerName = closureResult.data.closed_by
      ? ((staffResult.data ?? []).find(
          (person) => person.user_id === closureResult.data!.closed_by,
        )?.full_name ?? null)
      : null;

    closure = {
      declared_cash: closureResult.data.declared_cash,
      system_cash: closureResult.data.system_cash,
      variance: closureResult.data.variance,
      notes: closureResult.data.notes,
      closed_at: closureResult.data.closed_at,
      closed_by_name: closerName,
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
      <form className="flex items-end gap-2 rounded-2xl border border-border/60 bg-card p-2.5 shadow-sm md:flex-wrap md:rounded-xl md:p-3">
        <Button asChild variant="outline" size="icon" aria-label="Previous day" className="shrink-0">
          <Link href={`/billing/day-close?day=${shiftIstDay(selectedDay, -1)}`}>
            <ChevronLeftIcon />
          </Link>
        </Button>

        <div className="grid min-w-0 flex-1 gap-1.5 md:order-last md:flex-none">
          <span className="sr-only text-sm font-medium md:not-sr-only">Day (IST)</span>
          <DatePicker
            name="day"
            defaultValue={selectedDay}
            max={today}
            autoSubmit
            className="w-full justify-center font-medium md:w-44 md:justify-start md:font-normal"
          />
        </div>

        {atToday ? (
          <Button variant="outline" size="icon" disabled aria-label="Next day" className="shrink-0">
            <ChevronRightIcon />
          </Button>
        ) : (
          <Button asChild variant="outline" size="icon" aria-label="Next day" className="shrink-0">
            <Link href={`/billing/day-close?day=${shiftIstDay(selectedDay, 1)}`}>
              <ChevronRightIcon />
            </Link>
          </Button>
        )}
        <Button type="submit" className="hidden md:order-last md:inline-flex">
          Run
        </Button>
      </form>

      {/* The three numbers somebody actually reads out. */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
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
          wide
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

      {/* -------------------------------------------------------------------
          What the money was FOR.

          The section this screen was missing. "IPD -- 3 -- 1,100.00" is a
          heading with no page under it; a cashier or an owner reading the day
          wants to know it was a bed, a consultation and a dressing, and the
          department table can never say that.

          Full width and above the three narrow tables, because it is the only
          one that answers a question somebody arrived with.
          ------------------------------------------------------------------- */}
      <ServiceSection
        rows={report.byService}
        chargesTotal={chargesTotal}
        tax={tax}
        discounted={discounted}
        billed={billed}
        balances={bridgeBalances}
      />

      <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-4">
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

        {/* Who it came from. Same population as the three beside it -- payments
            taken today -- so it totals to Collected like they do. The MRN is
            under the name because a name is not an identifier in a hospital
            where three families share a surname. */}
        <Section
          title="By patient"
          caption="Who paid. One line per patient, however many bills they had."
          rows={report.byPatient.map((row) => ({
            key: row.key,
            label: row.label,
            detail: row.detail,
            count: row.entry_count,
            amount: row.amount,
          }))}
          total={collected}
          empty="Nobody paid anything on this day."
        />
      </div>

      {/* Every concession, by name. The total is a card at the top and there is
          nothing an owner can do with a total: the bill, the patient, the
          reason somebody typed at the counter and who raised it are what turn
          a leakage figure into a conversation. */}
      <ConcessionSection rows={report.concessions} total={discounted} />

      <p className="px-1 text-xs text-muted-foreground md:px-0">
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
  wide,
}: {
  label: string;
  value: number;
  note: string;
  strong?: boolean;
  /** Takes the whole row on a phone, so an odd tile does not leave a hole. */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm md:rounded-xl md:p-5',
        // On a phone the drawer total is the hero: full width, tinted.
        strong && 'col-span-2 border-l-4 border-l-primary bg-primary/[0.04] p-4 xl:col-span-1',
        wide && 'col-span-2 xl:col-span-1',
      )}
    >
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:text-xs">
        {label}
      </p>
      <p
        className={cn(
          'mt-1.5 truncate leading-none tabular-nums',
          strong
            ? 'text-3xl font-bold tracking-tight text-primary'
            : 'text-xl font-semibold text-foreground/80 md:text-2xl',
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
  rows: {
    key: string;
    label: string;
    /** Second line under the label: an MRN, a category. Optional. */
    detail?: string | null;
    count: number;
    amount: number;
  }[];
  total: number;
  empty?: string;
}) {
  return (
    <section className="grid min-w-0 content-start gap-2">
      <div className="px-1 md:px-0">
        <h2 className="text-base font-semibold md:text-lg md:font-medium">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl">
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
                  {/* max-w-0 + w-full is what lets a table cell truncate. */}
                  <TableCell className="w-full max-w-0 truncate">
                    {row.label}
                    {row.detail ? (
                      <span className="block font-mono text-[0.7rem] leading-tight text-muted-foreground">
                        {row.detail}
                      </span>
                    ) : null}
                  </TableCell>
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

/**
 * What the day was made of.
 *
 * Measured on the charge LINES of every bill raised today, which is a
 * different population from the payments the four grouped tables count -- so
 * it totals to Billed, not to Collected, and the footer does that arithmetic
 * out loud rather than leaving somebody to wonder why two numbers on the same
 * screen disagree.
 *
 * charge_items.amount is the pre-tax line total (its own CHECK constraint says
 * amount = round(qty * unit_price, 2)), so the bridge is:
 *
 *   charges + tax - concessions = billed
 *
 * On an OPD-only day tax is zero and it is one subtraction (CLAUDE.md 8).
 */
function ServiceSection({
  rows,
  chargesTotal,
  tax,
  discounted,
  billed,
  balances,
}: {
  rows: DayCloseRow[];
  chargesTotal: number;
  tax: number;
  discounted: number;
  billed: number;
  balances: boolean;
}) {
  return (
    <section className="grid content-start gap-2">
      <div className="px-1 md:px-0">
        <h2 className="text-base font-semibold md:text-lg md:font-medium">What the money was for</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every charge line on the bills raised today, grouped by service. This adds up to what
          was <strong className="font-medium">billed</strong>, not to what was collected &mdash; a
          payment is against a bill, never against the lines on it.
        </p>
      </div>

      {/* Phone: service over category, amount trailing, then the bridge. */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm md:hidden">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No bills were raised on this day.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border/60">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.detail
                        ? (SERVICE_CATEGORY_LABEL[row.detail as ServiceCategory] ?? row.detail)
                        : 'Typed at the counter'}{' '}
                      &middot; {row.entry_count} line{row.entry_count === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatAmount(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="grid gap-1.5 border-t-2 border-border bg-muted/40 px-3.5 py-3 text-sm">
              <div className="flex justify-between font-medium">
                <dt>Charges</dt>
                <dd className="tabular-nums">{formatAmount(chargesTotal)}</dd>
              </div>
              {tax > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Tax</dt>
                  <dd className="tabular-nums">+ {formatAmount(tax)}</dd>
                </div>
              ) : null}
              {discounted > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Concessions</dt>
                  <dd className="tabular-nums">&minus; {formatAmount(discounted)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <dt>Billed</dt>
                <dd className="tabular-nums">{formatAmount(billed)}</dd>
              </div>
            </dl>
          </>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm md:block md:rounded-xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead className="w-40">Category</TableHead>
              <TableHead className="w-20 text-right">Lines</TableHead>
              <TableHead className="w-32 text-right">Amount &#8377;</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                  No bills were raised on this day.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key} className="even:bg-muted/25">
                  <TableCell className="truncate">{row.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {/* The database returns the raw enum value; lib/services.ts
                        is the one place it is given a name. A line with no
                        service behind it was typed at the counter. */}
                    {row.detail
                      ? (SERVICE_CATEGORY_LABEL[row.detail as ServiceCategory] ?? row.detail)
                      : 'Typed at the counter'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {row.entry_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(row.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}

            {rows.length > 0 ? (
              <>
                <TableRow className="border-t-2 border-t-border bg-muted/40 hover:bg-muted/40">
                  <TableCell className="font-medium" colSpan={3}>
                    Charges
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatAmount(chargesTotal)}
                  </TableCell>
                </TableRow>
                {tax > 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="text-muted-foreground" colSpan={3}>
                      Tax
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      + {formatAmount(tax)}
                    </TableCell>
                  </TableRow>
                ) : null}
                {discounted > 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="text-muted-foreground" colSpan={3}>
                      Concessions
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      &minus; {formatAmount(discounted)}
                    </TableCell>
                  </TableRow>
                ) : null}
                <TableRow className="border-t border-t-border bg-muted/40 hover:bg-muted/40">
                  <TableCell className="font-medium" colSpan={3}>
                    Billed
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatAmount(billed)}
                  </TableCell>
                </TableRow>
              </>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {/* If the arithmetic ever fails to close, say so on the screen. A figure
          that is quietly wrong is the one thing this sheet cannot afford
          (CLAUDE.md 9, step 7). */}
      {rows.length > 0 && !balances ? (
        <p className="rounded-xl bg-destructive/10 px-3.5 py-3 text-xs text-destructive md:rounded-lg md:px-3 md:py-2">
          These lines do not add up to the billed total. Something on this day was written
          outside the normal path &mdash; send this date to whoever maintains the system.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Every concession given on the day, one row each.
 *
 * The headline card already carries the total, and a total is not something an
 * owner can do anything with. This is the list they actually want: which bill,
 * which patient, the reason typed at the counter, and the name against it.
 *
 * Hidden entirely on a day with no concessions rather than rendered empty. An
 * empty table here reads as a section that failed to load, and the card above
 * already says zero.
 */
function ConcessionSection({ rows, total }: { rows: DayCloseRow[]; total: number }) {
  if (rows.length === 0) return null;

  return (
    <section className="grid content-start gap-2">
      <div className="px-1 md:px-0">
        <h2 className="text-base font-semibold md:text-lg md:font-medium">Concessions given</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What came off a bill today, and why. The name is whoever raised the bill that carried
          it &mdash; nothing in the schema records a second person approving one.
        </p>
      </div>

      <div className="grid gap-2.5 md:hidden">
        {rows.map((row) => (
          <div key={row.key} className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{row.detail}</p>
                <Link
                  href={`/billing/invoices?q=${encodeURIComponent(row.label)}`}
                  className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                >
                  {row.label}
                </Link>
              </div>
              <span className="shrink-0 text-sm font-bold text-warning tabular-nums">
                &minus;{formatAmount(row.amount)}
              </span>
            </div>
            {row.note ? <p className="mt-2 text-sm text-muted-foreground">{row.note}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Raised by {row.actor_name ?? 'a login with no staff record'}
            </p>
          </div>
        ))}
        <div className="flex justify-between rounded-2xl bg-muted/60 px-4 py-3 text-sm font-semibold">
          <span>Total given away</span>
          <span className="tabular-nums">{formatAmount(total)}</span>
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm md:block md:rounded-xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-52">Invoice</TableHead>
              <TableHead className="w-48">Patient</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-44">Raised by</TableHead>
              <TableHead className="w-32 text-right">Amount &#8377;</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} className="even:bg-muted/25">
                <TableCell>
                  {/* Straight to the bill it came off. The invoice book searches
                      across every date, so the number on its own is enough. */}
                  <Link
                    href={`/billing/invoices?q=${encodeURIComponent(row.label)}`}
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {row.label}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{row.detail}</TableCell>
                <TableCell className="text-muted-foreground">{row.note}</TableCell>
                <TableCell className="truncate text-xs text-muted-foreground">
                  {row.actor_name ?? 'Login with no staff record'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(row.amount)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 border-t-border bg-muted/40 hover:bg-muted/40">
              <TableCell className="font-medium" colSpan={4}>
                Total given away
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatAmount(total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

import { ShieldCheckIcon } from 'lucide-react';
import Link from 'next/link';

import { IntegrityEvents } from './integrity-events';
import { AccessDenied } from '@/components/shell/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { Notice } from '@/components/shared/form-message';
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
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import {
  INTEGRITY_DESCRIPTION,
  INTEGRITY_KINDS,
  INTEGRITY_LABEL,
  cashIntegrityReport,
  groupIntegrity,
  type IntegrityRow,
} from '@/lib/rpc/integrity';
import { createClient } from '@/lib/supabase/server';
import { formatDate, shiftIstDay, todayIst } from '@/lib/utils/dates';
import { formatAmount, formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Cash integrity' };

/**
 * How many events come back at once.
 *
 * A cap on the DETAIL list only. The per-person summary above it is counted in
 * Postgres over the whole range and is never capped, which is the entire
 * reason the RPC returns two buckets: a league table folded from a truncated
 * event list would under-report exactly the person generating the most events.
 */
const EVENT_LIMIT = 500;

/** The presets, in days back from today. A week is the default. */
const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cash integrity.
 *
 * The five ways money leaves this system without a patient paying less than
 * they owed: a bill voided, a payment reversed, a concession given, a visit
 * let through unpaid, and a receipt printed more than once. Every one of them
 * is legitimate on its own and every one of them is also how leakage looks, so
 * this screen does not accuse -- it counts, names, and shows the reason that
 * was typed at the time.
 *
 * Deliberately a RANGE, not a day. The day close already answers "what
 * happened today". One void is an incident; six voids by one person in a week
 * is the thing an owner is actually trying to see, and a one-day screen can
 * never show it.
 *
 * Read-only, with no action on it at all. Reversing a reversal is not a thing,
 * and a screen that let somebody tidy up their own row would be worse than no
 * screen. The links go to the bill.
 */
export default async function IntegrityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireSession();

  // The proxy guards this route too (ROUTE_PERMISSIONS). This is the second
  // layer, and it is what a deep link from a stale bookmark hits.
  if (!session.access.permissions.has('reports.integrity')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="The integrity report"
        audience="administrators"
      />
    );
  }

  const supabase = await createClient();
  const { from, to } = await searchParams;

  const today = todayIst();
  const rangeTo = ISO_DATE.test(to ?? '') ? to! : today;
  const rangeFrom = ISO_DATE.test(from ?? '') ? from! : shiftIstDay(rangeTo, -6);

  // A range typed backwards is a slip at the date input, not an error worth a
  // page for: swap it and carry on, the way any date picker would.
  const [startDay, endDay] =
    rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];

  const { data, error } = await cashIntegrityReport(
    supabase,
    session.hospitalId,
    startDay,
    endDay,
    EVENT_LIMIT,
  );

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Cash integrity" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The report could not be run, so nothing is shown rather than a partial
          answer: {error.message}
        </p>
      </div>
    );
  }

  const report = groupIntegrity((data ?? []) as IntegrityRow[]);
  const capped = report.eventCount > report.events.length;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Cash integrity"
        /**
         * A count, and the one money figure that means something on its own.
         *
         * The five amounts are deliberately not added here or anywhere else:
         * a retired bill, a payment handed back and a concession are three
         * different quantities, and a reprint's amount is a bill that was
         * printed again rather than money that moved at all. Concessions are
         * the figure that stands alone -- it is the hospital choosing not to
         * take money, in full, once.
         */
        description={`${formatDate(startDay)} to ${formatDate(endDay)} · ${report.eventCount} event${report.eventCount === 1 ? '' : 's'} · ${formatMoney(report.totals.discount.amount)} given as concessions`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/billing/day-close">Day close</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/billing/dues">Dues</Link>
            </Button>
          </>
        }
      />

      {/* The range. A plain GET like the invoice and dues filters: the URL is
          the state, so a month a manager wants a second opinion on can be
          bookmarked or pasted into a message. */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm md:p-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">From</span>
          <Input type="date" name="from" defaultValue={startDay} max={today} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">To</span>
          <Input type="date" name="to" defaultValue={endDay} max={today} />
        </label>
        <Button type="submit">Show</Button>
        <div className="ml-auto flex items-center gap-1.5">
          {RANGES.map((range) => {
            const presetFrom = shiftIstDay(today, -(range.days - 1));
            const active = startDay === presetFrom && endDay === today;
            return (
              <Button
                key={range.days}
                asChild
                variant={active ? 'secondary' : 'ghost'}
                size="sm"
              >
                <Link href={`/reports/integrity?from=${presetFrom}&to=${today}`}>
                  {range.label}
                </Link>
              </Button>
            );
          })}
        </div>
      </form>

      {/* The one line an owner reads first. Not a total of the five columns --
          they are five different quantities and adding them would be
          meaningless -- but a count of the events that reached backwards into
          a day somebody had already counted the drawer for. */}
      {report.afterCloseCount > 0 ? (
        <div className="rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-destructive/5 px-4 py-3">
          <p className="text-sm font-semibold text-destructive">
            {report.afterCloseCount} of these happened after that day had already been
            closed
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A correction made before the drawer is counted is bookkeeping. One made
            afterwards changes a figure two people already signed off, and the rows
            below are marked.
          </p>
        </div>
      ) : null}

      {/* Five headline figures, one per kind. Each carries its own count and
          its own money, and they are deliberately never summed. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {INTEGRITY_KINDS.map((kind) => {
          const totals = report.totals[kind];
          return (
            <div
              key={kind}
              className={cn(
                'rounded-xl border border-border/60 bg-card p-4 shadow-sm',
                totals.afterClose > 0 && 'border-l-4 border-l-destructive',
              )}
            >
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {INTEGRITY_LABEL[kind]}
              </p>
              <p className="mt-1.5 text-2xl leading-none font-bold tracking-tight tabular-nums">
                {totals.count}
              </p>
              <p className="mt-1.5 text-sm font-medium tabular-nums">
                {formatMoney(totals.amount)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {INTEGRITY_DESCRIPTION[kind]}
              </p>
              {totals.afterClose > 0 ? (
                <p className="mt-1.5 text-xs font-medium text-destructive">
                  {totals.afterClose} after close
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {report.eventCount === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <EmptyState
            icon={ShieldCheckIcon}
            title="Nothing to look at in this range"
            description="No bill was voided, no payment reversed, no concession given, nobody let through unpaid and no receipt printed twice. Widen the range if you are checking a period further back."
          />
        </div>
      ) : (
        <>
          {/* The league table. One row per person, counted over the whole
              range -- this is the half of the screen that turns five numbers
              into a question worth asking somebody. */}
          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">By person</h2>
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Who</TableHead>
                    {INTEGRITY_KINDS.map((kind) => (
                      <TableHead key={kind} className="text-right">
                        {INTEGRITY_LABEL[kind]}
                      </TableHead>
                    ))}
                    <TableHead className="w-24 text-right">Events</TableHead>
                    <TableHead className="w-28 text-right">After close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.people.map((person) => (
                    <TableRow
                      key={person.actorId ?? 'system'}
                      className={cn(
                        'even:bg-muted/25',
                        person.afterClose > 0 && 'border-l-4 border-l-destructive',
                      )}
                    >
                      <TableCell className="font-medium">{person.actorName}</TableCell>
                      {INTEGRITY_KINDS.map((kind) => {
                        const cell = person.byKind[kind];
                        return (
                          <TableCell key={kind} className="text-right">
                            {cell.count === 0 ? (
                              <span className="text-muted-foreground/40">&mdash;</span>
                            ) : (
                              <>
                                <span className="block font-medium tabular-nums">
                                  {cell.count}
                                </span>
                                <span className="block text-xs text-muted-foreground tabular-nums">
                                  {formatAmount(cell.amount)}
                                </span>
                              </>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-semibold tabular-nums">
                        {person.total}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold tabular-nums',
                          person.afterClose > 0 && 'text-destructive',
                        )}
                      >
                        {person.afterClose === 0 ? (
                          <span className="font-normal text-muted-foreground/40">
                            &mdash;
                          </span>
                        ) : (
                          person.afterClose
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Counted over the whole range, not over the list below. Two figures in a
              cell: how many, and how much. The money in five columns measures five
              different things and is not meant to be added across.
            </p>
          </section>

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">What happened</h2>

            {capped ? (
              <Notice>
                Showing the {report.events.length} most recent of {report.eventCount}{' '}
                events. The figures above cover all {report.eventCount}. Narrow the
                range to see the rest.
              </Notice>
            ) : null}

            <IntegrityEvents events={report.events} />
          </section>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Days are IST calendar days, not the server&apos;s. Events are placed by when
        they happened, so a bill voided today appears today even when the bill itself
        is from last month &mdash; the &ldquo;after close&rdquo; mark is what says it
        reached back. Reprints count the second copy onwards; the first print of a
        receipt is the receipt. Voiding a bill also reverses the payments on it, and
        those reversals are not counted a second time &mdash; a void is one decision,
        whether or not the patient had already paid.
      </p>
    </div>
  );
}

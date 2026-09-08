import {
  CalendarCheckIcon,
  ShieldAlertIcon,
  WalletCardsIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { mayOpen } from '@/lib/rbac/routes';
import {
  cashIntegrityReport,
  groupIntegrity,
  type IntegrityRow,
} from '@/lib/rpc/integrity';
import { createClient } from '@/lib/supabase/server';
import { formatDate, shiftIstDay, todayIst } from '@/lib/utils/dates';
import { formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Reports' };

/**
 * The reports index.
 *
 * ROUTE_PERMISSIONS has had an entry for /reports since block 3 and there was
 * no directory behind it: a guarded path that 404s. The audit called it, and
 * the honest options were to build something or delete the line. There are now
 * three reports worth linking -- the day close, the outstanding dues and the
 * integrity report -- so this is a door rather than a dead end.
 *
 * Deliberately an INDEX and not a dashboard. `/` is already the hospital
 * overview with the day's takings on it; a second screen computing the same
 * figures differently is how two numbers for one day get onto two screens.
 * Each card carries one live figure, read from the report it links to, so the
 * page is worth opening rather than being a list of links.
 *
 * Every card is checked against the viewer's own permissions with mayOpen --
 * the same function the proxy guards on -- so nobody is offered a link they
 * will be bounced off.
 */
export default async function ReportsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const held = session.access.permissions;
  const today = todayIst();

  // Three small reads. Neither is the authority on anything: each is the
  // headline of the screen it links to.
  //
  // The integrity read is skipped entirely for a viewer who cannot open it.
  // Calling it anyway would raise 42501 inside the RPC, and a card that shows
  // a dash because the reader lacks a permission is indistinguishable from one
  // showing a dash because the query broke.
  const mayAudit = held.has('reports.integrity');

  const [dayClose, dues, integrity] = await Promise.all([
    supabase.rpc('day_close_report', { p_hospital_id: session.hospitalId, p_date: today }),
    supabase
      .from('invoice_summary')
      .select('balance')
      .eq('hospital_id', session.hospitalId)
      .in('status', ['unpaid', 'partial'])
      .gt('balance', 0),
    mayAudit
      ? cashIntegrityReport(supabase, session.hospitalId, shiftIstDay(today, -6), today, 1)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const collected =
    (dayClose.data ?? []).find((row) => row.bucket === 'total' && row.key === 'collected')
      ?.amount ?? 0;
  const outstanding = (dues.data ?? []).reduce((sum, row) => sum + row.balance, 0);
  // eventCount is folded from the summary bucket, which the RPC counts over
  // the whole range -- so p_limit: 1 above keeps the payload to one event row
  // without making the headline wrong.
  const audit = groupIntegrity((integrity.data ?? []) as IntegrityRow[]);

  const cards = [
    {
      href: '/billing/day-close',
      icon: CalendarCheckIcon,
      title: 'Day close',
      description:
        'What came in today, by payment mode, by the person who took it and by department. Count the drawer against it and record the variance.',
      figure: dayClose.error ? null : formatMoney(collected),
      figureLabel: `collected ${formatDate(today)}`,
    },
    {
      href: '/billing/dues',
      icon: WalletCardsIcon,
      title: 'Outstanding dues',
      description:
        'Every bill still owing, across all dates, with the phone number beside it and an ageing bucket on each row.',
      figure: dues.error ? null : formatMoney(outstanding),
      figureLabel: `${(dues.data ?? []).length} invoice${(dues.data ?? []).length === 1 ? '' : 's'} owing`,
    },
    {
      href: '/reports/integrity',
      icon: ShieldAlertIcon,
      title: 'Cash integrity',
      description:
        'Bills voided, payments reversed, concessions given, patients let through unpaid and receipts printed twice — by name, with the reason typed at the time.',
      figure: integrity.error ? null : String(audit.eventCount),
      // Not money: the five kinds measure five different things and a total of
      // them would be a number that means nothing. The count is the headline,
      // and the one qualifier worth putting on the card is how many of those
      // events landed on a day already closed.
      figureLabel:
        audit.afterCloseCount > 0
          ? `in 7 days · ${audit.afterCloseCount} after close`
          : 'in the last 7 days',
    },
  ].filter((card) => mayOpen(card.href, held));

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Reports"
        description="The money questions, and where each one is answered."
      />

      {cards.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
          Your role can open this page but none of the reports behind it. Ask an administrator
          for billing.read or reports.view.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <ReportCard key={card.href} {...card} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Every figure here is the headline of the screen it links to, read at the same moment as
        the rest of this page. Days are IST calendar days, not the server&apos;s.
      </p>
    </div>
  );
}

function ReportCard({
  href,
  icon: Icon,
  title,
  description,
  figure,
  figureLabel,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** null when the read failed -- shown as such rather than as zero. */
  figure: string | null;
  figureLabel: string;
}) {
  return (
    <Link
      href={href}
      className="grid content-start gap-2 rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-colors hover:border-ring/60 md:p-5"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">{title}</span>
      </span>

      {/* A failed read says so. A report that shows zero when it could not
          count is worse than a report that admits it did not (CLAUDE.md 7). */}
      {figure === null ? (
        <span className="text-sm text-destructive">
          This figure could not be read. Open the report itself.
        </span>
      ) : (
        <span>
          <span className="text-2xl leading-none font-bold tracking-tight tabular-nums">
            {figure}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">{figureLabel}</span>
        </span>
      )}

      <span className="text-sm text-muted-foreground">{description}</span>
    </Link>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CalendarClockIcon } from 'lucide-react';

import { TransferDialog, type TransferDoctor } from '../incomplete/transfer-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { ageGender, type Gender } from '@/lib/patients';
import { createClient } from '@/lib/supabase/client';
import { formatTime } from '@/lib/utils/dates';
import { formatAmount } from '@/lib/utils/money';
import {
  VISIT_STATUSES,
  VISIT_STATUS_LABEL,
  VISIT_STATUS_VARIANT,
  VISIT_TYPE_LABEL,
  type VisitStatus,
  type VisitType,
} from '@/lib/visits';

export type QueueEntry = {
  id: string;
  visit_no: string;
  token_no: number;
  visit_type: VisitType;
  status: VisitStatus;
  visited_at: string;
  patient_id: string;
  patient_mrn: string;
  patient_name: string;
  patient_dob: string;
  patient_gender: Gender;
  patient_phone: string | null;
  doctor_name: string | null;
  department_name: string | null;
  charge_total: number;
  /** An invoice on this visit is still unpaid or part paid. */
  payment_due: boolean;
  /** Set when the desk deliberately let them through without paying. */
  defer_reason: string | null;
};

/**
 * PAYMENT DUE.
 *
 * Deliberately loud, and deliberately on the row rather than only on the
 * invoice: the person who needs to see it is the one calling the next patient,
 * and by the time anybody opens a bill the patient has already been seen. The
 * reason is in the title attribute because "why" is the second question and
 * the badge has no room for it.
 */
function PaymentDue({ reason }: { reason: string | null }) {
  return (
    <span
      title={reason ?? 'No payment recorded against this visit yet.'}
      className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-warning uppercase ring-1 ring-warning/40"
    >
      Payment due
    </span>
  );
}

/** Several registrations in the same second should cost one refresh, not five. */
const REFRESH_DEBOUNCE_MS = 250;

export function QueueBoard({
  entries,
  hospitalId,
  doctors,
  canManage,
}: {
  entries: QueueEntry[];
  hospitalId: string;
  /** For the transfer dialog. Active doctors only. */
  doctors: TransferDoctor[];
  /** queue.manage. Without it the row has no Transfer button. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        // The rows are rendered on the server, so the update path is the same
        // one a plain page load takes -- one read model, one set of policies.
        // Realtime only says "something changed", never what the row now says.
        router.refresh();
        setUpdatedAt(new Date().toISOString());
      }, REFRESH_DEBOUNCE_MS);
    }

    void (async () => {
      // Realtime applies RLS using the token it was given, so it needs the
      // session before it subscribes. Without this the channel can come up
      // unauthenticated on a cold load and quietly deliver nothing.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

      await supabase.realtime.setAuth(session?.access_token);
      if (cancelled) return;

      channel = supabase
        .channel(`queue:${hospitalId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'visits',
            filter: `hospital_id=eq.${hospitalId}`,
          },
          scheduleRefresh,
        )
        .subscribe((status) => {
          if (!cancelled) setLive(status === 'SUBSCRIBED');
        });
    })();

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [hospitalId, router]);

  const counts = useMemo(() => {
    const byStatus = new Map<VisitStatus, number>(VISIT_STATUSES.map((s) => [s, 0]));
    for (const entry of entries) {
      byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
    }
    return byStatus;
  }, [entries]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {VISIT_STATUSES.map((status) => (
          <span key={status} className="flex items-center gap-1.5 text-xs">
            <Badge variant={VISIT_STATUS_VARIANT[status]}>{counts.get(status) ?? 0}</Badge>
            <span className="text-muted-foreground">{VISIT_STATUS_LABEL[status]}</span>
          </span>
        ))}

        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {/* The dot pulses only while the channel is actually subscribed. A
              board that animates whether or not it is connected is a board
              nobody checks -- and this one is read from across the room. */}
          <span className="relative grid size-2 place-items-center" aria-hidden>
            {live ? (
              <span className="absolute size-2 animate-ping rounded-full bg-success/60" />
            ) : null}
            <span
              className={cn(
                'size-2 rounded-full',
                live ? 'bg-success' : 'bg-muted-foreground/40',
              )}
            />
          </span>
          {live ? 'Live' : 'Connecting...'}
          {updatedAt ? <span>&middot; updated {formatTime(updatedAt)}</span> : null}
        </span>
      </div>

      {/* Below `md` a nine-column table is a horizontal scroll nobody performs
          at a counter, so the same rows render as cards. One source of data,
          two shapes -- not two lists that can disagree. */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <EmptyState
            icon={CalendarClockIcon}
            title="Nobody has been registered today yet"
            description="Tokens appear here the moment the front desk starts a visit."
          />
        </div>
      ) : (
        <div className="grid gap-2 md:hidden">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm',
                entry.status === 'cancelled' && 'opacity-60',
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-base font-bold text-primary-foreground tabular-nums">
                {entry.token_no}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/patients/${entry.patient_id}`}
                    className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                  >
                    {entry.patient_name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {entry.payment_due ? <PaymentDue reason={entry.defer_reason} /> : null}
                    <Badge variant={VISIT_STATUS_VARIANT[entry.status]}>
                      {VISIT_STATUS_LABEL[entry.status]}
                    </Badge>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {ageGender(entry.patient_dob, entry.patient_gender)} &middot;{' '}
                  <span className="font-mono">{entry.patient_mrn}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">
                    {entry.doctor_name ?? 'No doctor'}
                  </span>
                  {entry.visit_type === 'opd' ? null : (
                    <Badge variant="destructive">{VISIT_TYPE_LABEL[entry.visit_type]}</Badge>
                  )}
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {formatTime(entry.visited_at)}
                  </span>
                  <span className="font-medium tabular-nums">
                    &#8377;{formatAmount(entry.charge_total)}
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className={cn(
          'rounded-xl border border-border/60 bg-card shadow-sm',
          entries.length === 0 ? 'hidden' : 'hidden md:block',
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Token</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="w-20">Age / sex</TableHead>
              <TableHead className="w-44">Doctor</TableHead>
              <TableHead className="w-40">Department</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-28 text-right">Charges &#8377;</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-28 text-right">Move</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow
                key={entry.id}
                className={entry.status === 'cancelled' ? 'opacity-60' : undefined}
              >
                <TableCell>
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground tabular-nums">
                    {entry.token_no}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatTime(entry.visited_at)}
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    {/* The name is the door to the record: the desk is asked
                        "when was she last here" far more often than anything
                        else on this row. */}
                    <Link
                      href={`/patients/${entry.patient_id}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {entry.patient_name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.patient_mrn}
                      {entry.patient_phone ? ` - ${entry.patient_phone}` : ''}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {ageGender(entry.patient_dob, entry.patient_gender)}
                </TableCell>
                <TableCell className="truncate text-xs">{entry.doctor_name ?? '-'}</TableCell>
                <TableCell className="truncate text-xs">
                  {entry.department_name ?? '-'}
                </TableCell>
                <TableCell className="text-xs">
                  {entry.visit_type === 'opd' ? (
                    <span className="text-muted-foreground">
                      {VISIT_TYPE_LABEL[entry.visit_type]}
                    </span>
                  ) : (
                    // Emergency is the one that has to catch an eye across
                    // the counter.
                    <Badge variant="destructive">{VISIT_TYPE_LABEL[entry.visit_type]}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(entry.charge_total)}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={VISIT_STATUS_VARIANT[entry.status]}>
                      {VISIT_STATUS_LABEL[entry.status]}
                    </Badge>
                    {entry.payment_due ? <PaymentDue reason={entry.defer_reason} /> : null}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {/* The ONLY way a visit's doctor changes after registration
                      (block 7.1). Closed visits are left alone: moving somebody
                      who has already been seen would retire a token for no
                      reason and misattribute the consultation. */}
                  {canManage &&
                  (entry.status === 'waiting' || entry.status === 'in_consultation') ? (
                    <TransferDialog
                      visitId={entry.id}
                      patientName={entry.patient_name}
                      currentDoctor={entry.doctor_name}
                      doctors={doctors}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Tokens restart at 1 every day. Visit numbers do not &mdash; they run for the financial
        year.
      </p>
    </>
  );
}

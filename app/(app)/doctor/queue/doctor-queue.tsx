'use client';

import { CheckIcon, FileTextIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import {
  VISIT_STATUS_LABEL,
  VISIT_STATUS_VARIANT,
  VISIT_TYPE_LABEL,
  isOpenStatus,
  type VisitStatus,
  type VisitType,
} from '@/lib/visits';

export type DoctorQueueEntry = {
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
  department_name: string | null;
  /** Something has been written in the notes for this visit. */
  has_notes: boolean;
  /** When the consultation record was last touched, if it exists. */
  seen_at: string | null;
};

/** Several registrations in the same second should cost one refresh, not five. */
const REFRESH_DEBOUNCE_MS = 250;

/**
 * The doctor's own board.
 *
 * Rendered on the server and refreshed by Realtime, exactly as the front-desk
 * queue is (app/(app)/front-desk/queue/queue-board.tsx): the subscription only
 * ever says "something changed", never what the row now says, so there is one
 * read model and one set of policies behind both the first paint and every
 * update.
 *
 * Arrow keys move, Enter opens. The doctor module is not on the keyboard-first
 * list in CLAUDE.md 7 -- front desk, billing and pharmacy are -- but a queue is
 * a list, and a list that cannot be walked with the arrow keys is a list that
 * needs a mouse for no reason.
 */
export function DoctorQueue({
  entries,
  hospitalId,
  doctorId,
}: {
  entries: DoctorQueueEntry[];
  hospitalId: string;
  doctorId: string;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLTableSectionElement>(null);

  /**
   * Waiting and with-the-doctor are the queue. Completed and cancelled are
   * history -- shown underneath, because "did I already see this patient?" is
   * asked constantly and the answer is otherwise a page reload away.
   */
  const open = useMemo(() => entries.filter((entry) => isOpenStatus(entry.status)), [entries]);
  const closed = useMemo(() => entries.filter((entry) => !isOpenStatus(entry.status)), [entries]);

  const openVisit = useCallback(
    (visitId: string) => router.push(`/doctor/visit/${visitId}`),
    [router],
  );

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
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
        .channel(`doctor-queue:${hospitalId}:${doctorId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'visits',
            // Postgres changes take one filter, so this narrows to the
            // hospital and the doctor is matched by the query behind the
            // refresh. The extra refreshes cost one cached server render.
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
  }, [hospitalId, doctorId, router]);

  /**
   * The row the keyboard is on, clamped to a queue that shrinks underneath it.
   * Derived during render rather than corrected in an effect: an effect would
   * paint a highlight past the end of the list once before fixing itself, and
   * Enter in that frame would open nothing.
   */
  const active = Math.min(highlight, Math.max(open.length - 1, 0));

  // Keep the highlighted row visible when the queue is longer than the screen.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;
      if (open.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight(Math.min(active + 1, open.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight(Math.max(active - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const entry = open[active];
        if (entry) openVisit(entry.id);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, active, openVisit]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          <Badge>{open.length}</Badge>
          <span className="text-muted-foreground">
            {open.length === 1 ? 'patient waiting' : 'patients waiting'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <Badge variant="outline">{closed.filter((e) => e.status === 'completed').length}</Badge>
          <span className="text-muted-foreground">seen today</span>
        </span>

        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              live ? 'bg-emerald-500' : 'bg-muted-foreground/40',
            )}
            aria-hidden
          />
          {live ? 'Live' : 'Connecting...'}
          {updatedAt ? <span>&middot; updated {formatTime(updatedAt)}</span> : null}
        </span>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-right">Token</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="w-20">Age / sex</TableHead>
              <TableHead className="w-40">Department</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={listRef}>
            {open.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                  Nobody is waiting for you right now.
                </TableCell>
              </TableRow>
            ) : (
              open.map((entry, index) => (
                <TableRow
                  key={entry.id}
                  data-index={index}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${entry.patient_name}, token ${entry.token_no}`}
                  onClick={() => openVisit(entry.id)}
                  onFocus={() => setHighlight(index)}
                  className={cn('cursor-pointer', index === active && 'bg-accent/60 outline-none')}
                >
                  <TableCell className="text-right text-base font-semibold tabular-nums">
                    {entry.token_no}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(entry.visited_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{entry.patient_name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {entry.patient_mrn}
                        {entry.patient_phone ? ` - ${entry.patient_phone}` : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {ageGender(entry.patient_dob, entry.patient_gender)}
                  </TableCell>
                  <TableCell className="truncate text-xs">
                    {entry.department_name ?? '-'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.visit_type === 'opd' ? (
                      <span className="text-muted-foreground">
                        {VISIT_TYPE_LABEL[entry.visit_type]}
                      </span>
                    ) : (
                      <Badge variant="destructive">{VISIT_TYPE_LABEL[entry.visit_type]}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={VISIT_STATUS_VARIANT[entry.status]}>
                      {VISIT_STATUS_LABEL[entry.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entry.has_notes ? (
                      <span className="flex items-center gap-1">
                        <FileTextIcon className="size-3.5" aria-hidden />
                        Started
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {closed.length > 0 ? (
        <section className="grid gap-1.5">
          <h2 className="text-xs font-medium text-muted-foreground">Earlier today</h2>
          <ul className="grid gap-px overflow-hidden rounded-lg border">
            {closed.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => openVisit(entry.id)}
                  className={cn(
                    'flex w-full items-center gap-3 bg-background px-3 py-1.5 text-left text-xs hover:bg-accent/50',
                    entry.status === 'cancelled' && 'opacity-60',
                  )}
                >
                  <span className="w-8 text-right font-semibold tabular-nums">
                    {entry.token_no}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {entry.patient_name}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {entry.patient_mrn}
                  </span>
                  <span className="w-20 text-right text-[11px] text-muted-foreground tabular-nums">
                    {entry.seen_at ? formatTime(entry.seen_at) : ''}
                  </span>
                  <Badge variant={VISIT_STATUS_VARIANT[entry.status]}>
                    {VISIT_STATUS_LABEL[entry.status]}
                  </Badge>
                  {entry.has_notes ? (
                    <CheckIcon className="size-3.5 text-emerald-600" aria-label="Notes written" />
                  ) : (
                    <span className="size-3.5" aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        <kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd>{' '}
        to move, <kbd className="rounded border px-1">Enter</kbd> to open. The queue updates
        itself as the front desk registers patients.
      </p>
    </>
  );
}

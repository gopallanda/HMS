'use client';

import {
  CheckIcon,
  CircleCheckBigIcon,
  CoffeeIcon,
  FileTextIcon,
  PlayIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setVisitStatusAction } from './actions';
import { EmptyState } from '@/components/shared/empty-state';
import { KbdHint } from '@/components/shared/kbd';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import type { QueueStatus } from '@/lib/rpc/visits';
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

  /**
   * Who is actually in the room, and who is next.
   *
   * Both are printed at the top because they are the two things the doctor is
   * asked out loud all morning, and because they are the two things that only
   * become true if visits are being completed -- so they double as the
   * feedback that the Complete button did something.
   */
  const withDoctor = useMemo(
    () => open.find((entry) => entry.status === 'in_consultation') ?? null,
    [open],
  );
  const nextUp = useMemo(
    () => open.find((entry) => entry.status === 'waiting') ?? null,
    [open],
  );

  const openVisit = useCallback(
    (visitId: string) => router.push(`/doctor/visit/${visitId}`),
    [router],
  );

  /**
   * Moving a patient through the queue without opening the notes (defect 3).
   *
   * The doctor's actual morning is: call the token, look at the patient, send
   * them out. Most of those thirty encounters never get typed on. Before this
   * the only thing that could take a visit off the board was saving a
   * consultation, so the board never emptied, the tokens never rotated, and
   * the waiting count the front desk reads next to this doctor's name was
   * wrong within the hour.
   *
   * The visit id is held as the pending marker rather than a boolean, so two
   * rows tapped in quick succession each disable only themselves.
   */
  const [pendingVisit, setPendingVisit] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const move = useCallback((visitId: string, status: QueueStatus) => {
    setPendingVisit(visitId);
    startTransition(async () => {
      const result = await setVisitStatusAction(visitId, status);
      setPendingVisit((current) => (current === visitId ? null : current));

      // Never swallowed into a row that silently does not move (CLAUDE.md 7).
      // A refusal here is usually "that visit is booked to another doctor",
      // which is a sentence the doctor can act on.
      if (result.status === 'error') toast.error(result.message);
      else if (result.status === 'success') toast.success(result.message);
    });
  }, []);

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
      } else if (event.key === 'c' || event.key === 'C') {
        // The single most-pressed key on this screen once the morning starts.
        // Deliberately unmodified: the doctor is not holding the mouse, and
        // the guard above has already excluded anything with a text cursor
        // in it.
        event.preventDefault();
        const entry = open[active];
        if (entry) move(entry.id, 'completed');
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        const entry = open[active];
        if (entry && entry.status === 'waiting') move(entry.id, 'in_consultation');
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, active, openVisit, move]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
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

        {withDoctor ? (
          <span className="flex items-center gap-1.5">
            <Badge variant="info">Token {withDoctor.token_no}</Badge>
            <span className="truncate text-muted-foreground">
              with you &middot; {withDoctor.patient_name}
            </span>
          </span>
        ) : nextUp ? (
          <span className="flex items-center gap-1.5">
            <Badge variant="warning">Token {nextUp.token_no}</Badge>
            <span className="truncate text-muted-foreground">
              next &middot; {nextUp.patient_name}
            </span>
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
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

      {open.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <EmptyState
            icon={CoffeeIcon}
            title="Nobody is waiting for you right now"
            description="New patients appear here the moment the front desk assigns them to you."
          />
        </div>
      ) : (
        // Below `md` the row becomes a card. A doctor reads this on a phone
        // between consultations, where a seven-column table is a scroll.
        <div className="grid gap-2 md:hidden">
          {open.map((entry, index) => (
            // role="button" rather than a real one: the row now CONTAINS
            // buttons, and a button inside a button is invalid markup that
            // browsers resolve by dropping one of them -- which would be the
            // Complete button, on the screen where it matters most.
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              data-index={index}
              onClick={() => openVisit(entry.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openVisit(entry.id);
                }
              }}
              onFocus={() => setHighlight(index)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors',
                index === active ? 'border-primary/40 bg-primary/5' : 'border-border/60',
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-base font-bold text-primary-foreground tabular-nums">
                {entry.token_no}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{entry.patient_name}</span>
                  <Badge variant={VISIT_STATUS_VARIANT[entry.status]} className="shrink-0">
                    {VISIT_STATUS_LABEL[entry.status]}
                  </Badge>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {ageGender(entry.patient_dob, entry.patient_gender)} &middot;{' '}
                  <span className="font-mono">{entry.patient_mrn}</span>
                </span>
                <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatTime(entry.visited_at)}</span>
                  {entry.visit_type === 'opd' ? null : (
                    <Badge variant="destructive">{VISIT_TYPE_LABEL[entry.visit_type]}</Badge>
                  )}
                  {entry.has_notes ? (
                    <span className="ml-auto flex items-center gap-1">
                      <FileTextIcon className="size-3.5" aria-hidden />
                      Started
                    </span>
                  ) : null}
                </span>

                {/* Full width on a phone. This is the button the doctor
                    presses between patients, one-handed, and a 32px icon at
                    the end of a row is not a target for that. */}
                <QueueActions
                  entry={entry}
                  pending={pendingVisit === entry.id}
                  onMove={move}
                  className="mt-2.5 w-full"
                  block
                />
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        className={cn(
          'overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm',
          open.length === 0 ? 'hidden' : 'hidden md:block',
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Token</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="w-20">Age / sex</TableHead>
              <TableHead className="w-40">Department</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24">Notes</TableHead>
              <TableHead className="w-44 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={listRef}>
            {open.map((entry, index) => (
              <TableRow
                key={entry.id}
                data-index={index}
                tabIndex={0}
                role="button"
                aria-label={`Open ${entry.patient_name}, token ${entry.token_no}`}
                onClick={() => openVisit(entry.id)}
                onFocus={() => setHighlight(index)}
                className={cn(
                  'cursor-pointer',
                  index === active && 'bg-primary/10 outline-none hover:bg-primary/10',
                )}
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
                    <span className="truncate font-medium">{entry.patient_name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
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
                <TableCell>
                  <QueueActions
                    entry={entry}
                    pending={pendingVisit === entry.id}
                    onMove={move}
                    className="justify-end"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {closed.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground/60 uppercase">
            Earlier today
          </h2>
          <ul className="grid overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
            {closed.map((entry) => (
              <li key={entry.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openVisit(entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openVisit(entry.id);
                    }
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 text-left text-xs transition-colors last:border-0 hover:bg-muted/50',
                    entry.status === 'cancelled' && 'opacity-60',
                  )}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                    {entry.token_no}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {entry.patient_name}
                  </span>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                    {entry.patient_mrn}
                  </span>
                  <span className="hidden w-20 text-right text-xs text-muted-foreground tabular-nums sm:block">
                    {entry.seen_at ? formatTime(entry.seen_at) : ''}
                  </span>
                  <Badge variant={VISIT_STATUS_VARIANT[entry.status]}>
                    {VISIT_STATUS_LABEL[entry.status]}
                  </Badge>
                  {entry.has_notes ? (
                    <CheckIcon className="size-3.5 text-success" aria-label="Notes written" />
                  ) : (
                    <span className="size-3.5" aria-hidden />
                  )}

                  {/* Completed by mistake, or the patient came straight back
                      through the door. Cancelled visits get no button: a
                      cancellation is a front-desk decision about a token and
                      about money, and undoing it here would be the doctor
                      overruling both. */}
                  {entry.status === 'completed' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pendingVisit === entry.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        move(entry.id, 'in_consultation');
                      }}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      Reopen
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <KbdHint keys={['\u2191', '\u2193']}>move</KbdHint>
        <KbdHint keys="Enter">open notes</KbdHint>
        <KbdHint keys="S">call in</KbdHint>
        <KbdHint keys="C">complete</KbdHint>
        <span>The queue updates itself as the front desk registers patients.</span>
      </p>
    </>
  );
}

/**
 * What a doctor can do to a row without opening it.
 *
 * Two verbs and no more. "Call in" moves the patient to with-the-doctor so the
 * board and the front desk can both see who is in the room; "Complete" is the
 * one that rotates the token and is therefore the primary. There is no Cancel
 * here on purpose -- cancelling a visit is a decision about a token somebody is
 * holding a slip for and about money already collected, so it stays a
 * front-desk act with a reason attached, like void_invoice and transfer_visit.
 *
 * Every click stops propagating: the row underneath opens the consultation,
 * and a doctor who meant "done" must never land in a text area instead.
 */
function QueueActions({
  entry,
  pending,
  onMove,
  className,
  block = false,
}: {
  entry: DoctorQueueEntry;
  pending: boolean;
  onMove: (visitId: string, status: QueueStatus) => void;
  className?: string;
  /** Phone layout: the buttons share the width instead of hugging the end. */
  block?: boolean;
}) {
  function act(event: React.MouseEvent, status: QueueStatus) {
    event.stopPropagation();
    onMove(entry.id, status);
  }

  return (
    <span
      className={cn('flex items-center gap-1.5', className)}
      onClick={(event) => event.stopPropagation()}
    >
      {entry.status === 'waiting' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          className={cn(block && 'flex-1')}
          onClick={(event) => act(event, 'in_consultation')}
          aria-label={`Call in token ${entry.token_no}`}
        >
          <PlayIcon data-icon="inline-start" />
          Call in
        </Button>
      ) : null}

      <Button
        type="button"
        size="sm"
        disabled={pending}
        className={cn(block && 'flex-1')}
        onClick={(event) => act(event, 'completed')}
        aria-label={`Complete token ${entry.token_no}`}
      >
        <CircleCheckBigIcon data-icon="inline-start" />
        {pending ? 'Saving...' : 'Complete'}
      </Button>
    </span>
  );
}

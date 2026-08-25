'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  patient_mrn: string;
  patient_name: string;
  patient_dob: string;
  patient_gender: Gender;
  patient_phone: string | null;
  doctor_name: string | null;
  department_name: string | null;
  charge_total: number;
};

/** Several registrations in the same second should cost one refresh, not five. */
const REFRESH_DEBOUNCE_MS = 250;

export function QueueBoard({
  entries,
  hospitalId,
}: {
  entries: QueueEntry[];
  hospitalId: string;
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
      <div className="flex flex-wrap items-center gap-2">
        {VISIT_STATUSES.map((status) => (
          <span key={status} className="flex items-center gap-1.5 text-xs">
            <Badge variant={VISIT_STATUS_VARIANT[status]}>{counts.get(status) ?? 0}</Badge>
            <span className="text-muted-foreground">{VISIT_STATUS_LABEL[status]}</span>
          </span>
        ))}

        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
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
              <TableHead className="w-44">Doctor</TableHead>
              <TableHead className="w-40">Department</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-28 text-right">Charges &#8377;</TableHead>
              <TableHead className="w-28">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-xs text-muted-foreground">
                  Nobody has been registered today yet.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={entry.status === 'cancelled' ? 'opacity-60' : undefined}
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
                    <Badge variant={VISIT_STATUS_VARIANT[entry.status]}>
                      {VISIT_STATUS_LABEL[entry.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Tokens restart at 1 every day. Visit numbers do not - they run for the financial year.
      </p>
    </>
  );
}

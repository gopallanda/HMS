import { StethoscopeIcon } from 'lucide-react';

import { DoctorQueue, type DoctorQueueEntry } from './doctor-queue';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayIst } from '@/lib/utils/dates';

export const metadata = { title: 'My queue' };

/**
 * Today's queue for the doctor who is signed in.
 *
 * "Mine" is a staff id, not a user id: visits.doctor_id references staff,
 * because a staff record exists before a login does (CLAUDE.md 4). A login
 * with no staff record therefore has no queue -- which is a sentence to
 * print, not an empty table to leave someone staring at.
 */
export default async function DoctorQueuePage() {
  const session = await requireSession();

  // Today in IST, not in the server's timezone (lib/utils/dates.ts).
  const today = todayIst();

  if (session.staffId === null) {
    return (
      <div className="grid gap-4">
        <PageHeader title="My queue" description={formatDate(today)} />
        <Card className="mx-auto mt-6 max-w-md">
          <CardContent className="grid gap-3 text-center">
            <span className="mx-auto flex size-9 items-center justify-center rounded-lg bg-muted">
              <StethoscopeIcon className="size-4 text-muted-foreground" />
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-semibold">This login has no staff record</p>
              <p className="text-xs text-muted-foreground">
                A queue follows the doctor on the staff list, not the account. Ask an
                administrator to attach this login to your staff record under Admin &rarr;
                Staff, and today&apos;s patients will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();

  // visit_queue is a security_invoker view, so RLS still scopes this to the
  // caller's hospital. The hospital_id filter is here anyway, because a query
  // that only works because of a policy is a query nobody can read.
  //
  // Every status is fetched, not just the open ones: the doctor splits them
  // below, and a visit seen an hour ago has to stay reachable to correct a
  // note. Ten to forty rows a day -- filtering in the browser is cheaper than
  // a second round trip.
  const { data, error } = await supabase
    .from('visit_queue')
    .select(
      'id, visit_no, token_no, visit_type, status, visited_at, patient_id, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, department_name',
    )
    .eq('hospital_id', session.hospitalId)
    .eq('doctor_id', session.staffId)
    .eq('visit_date', today)
    .order('token_no');

  if (error) {
    return (
      <div className="grid gap-4">
        <PageHeader title="My queue" description={formatDate(today)} />
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Your queue could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  const visits = data ?? [];

  /**
   * Which of these already have something written. One extra query rather
   * than a column on the view: the queue is a read model of visits, and a
   * "notes started" marker is a doctor-screen concern that the front desk
   * board has no use for.
   *
   * consultations is readable only by clinical roles, and this page is behind
   * that gate, so a failure here means something is genuinely wrong -- it is
   * reported rather than swallowed into a queue with no markers (CLAUDE.md 7).
   */
  const written =
    visits.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('consultations')
          .select('visit_id, notes, updated_at')
          .eq('hospital_id', session.hospitalId)
          .in(
            'visit_id',
            visits.map((visit) => visit.id),
          );

  const writtenError = written.error;
  const byVisit = new Map((written.data ?? []).map((row) => [row.visit_id, row]));

  const entries: DoctorQueueEntry[] = visits.map((visit) => ({
    ...visit,
    has_notes: (byVisit.get(visit.id)?.notes ?? null) !== null,
    seen_at: byVisit.get(visit.id)?.updated_at ?? null,
  }));

  return (
    <div className="grid gap-3">
      <PageHeader
        title="My queue"
        description={`${session.staffName ?? 'Today'} · ${formatDate(today)}`}
      />
      {writtenError ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Your queue is shown, but the notes written so far could not be read:{' '}
          {writtenError.message}
        </p>
      ) : null}
      <DoctorQueue entries={entries} hospitalId={session.hospitalId} doctorId={session.staffId} />
    </div>
  );
}

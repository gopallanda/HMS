import Link from 'next/link';

import { QueueBoard, type QueueEntry } from './queue-board';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayIst } from '@/lib/utils/dates';

export const metadata = { title: 'Queue' };

export default async function QueuePage() {
  const session = await requireSession();
  const supabase = await createClient();

  // Today in IST, not in the server's timezone: a box in Washington would put
  // the morning queue on yesterday's date for five and a half hours.
  const today = todayIst();

  // visit_queue is a security_invoker view, so RLS still scopes this to the
  // caller's hospital. The hospital_id filter is here anyway, because a query
  // that only works because of a policy is a query nobody can read.
  //
  // payment_due comes from a SECURITY DEFINER helper rather than from a join
  // on invoices, so the badge is visible to a nurse watching the queue without
  // opening the invoice itself to her (20260829090000).
  const [queueResult, doctorResult, incompleteResult] = await Promise.all([
    supabase
      .from('visit_queue')
      .select(
      'id, visit_no, token_no, visit_type, status, visited_at, patient_id, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, doctor_name, department_name, charge_total, payment_due, defer_reason',
    )
      .eq('hospital_id', session.hospitalId)
      .eq('visit_date', today)
      .order('token_no'),
    supabase
      .from('staff')
      .select('id, full_name, department_id')
      .eq('hospital_id', session.hospitalId)
      .eq('role', 'doctor')
      .eq('is_active', true)
      .order('full_name'),
    // Head-only: the repair list is expected to be empty, and the link to it
    // only earns a place in the header when it is not (block 7.2).
    supabase
      .from('incomplete_visits')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', session.hospitalId),
  ]);

  const { data, error } = queueResult;

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Queue" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The queue could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  const entries: QueueEntry[] = data ?? [];
  const doctors = doctorResult.data ?? [];
  const needRepair = incompleteResult.count ?? 0;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Queue"
        description={`Tokens issued today, ${formatDate(today)}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {needRepair > 0 ? (
              <Button asChild variant="outline">
                <Link href="/front-desk/incomplete">
                  {needRepair} need a doctor
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/front-desk/register">Register patient</Link>
            </Button>
          </div>
        }
      />
      <QueueBoard
        entries={entries}
        hospitalId={session.hospitalId}
        doctors={doctors}
        canManage={session.access.permissions.has('queue.manage')}
      />
    </div>
  );
}

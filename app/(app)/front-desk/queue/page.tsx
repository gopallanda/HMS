import Link from 'next/link';

import { QueueBoard, type QueueDue, type QueueEntry } from './queue-board';
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

  // ---------------------------------------------------------------------------
  // What the PAYMENT DUE badge is actually worth, for whoever may see money.
  //
  // A SECOND read, deliberately not folded into visit_queue. That view exposes
  // payment_due as a bare bit through a SECURITY DEFINER helper so a nurse can
  // watch the board without the invoice being opened to her; joining the amount
  // in would undo exactly that. This read goes through invoices_select_billing
  // instead, so for a role that may not see money it comes back empty and the
  // badge stays the statement it has always been.
  //
  // Only fired when something is actually due, and only for the visits on
  // screen. Oldest first, so a visit carrying two unpaid bills offers the one
  // that has been owing longest.
  // ---------------------------------------------------------------------------
  const dueVisitIds = entries.filter((entry) => entry.payment_due).map((entry) => entry.id);
  const dues: Record<string, QueueDue> = {};

  if (dueVisitIds.length > 0 && session.access.permissions.has('billing.collect')) {
    const { data: outstanding } = await supabase
      .from('invoice_summary')
      .select('id, invoice_no, visit_id, patient_name_snapshot, balance, status')
      .eq('hospital_id', session.hospitalId)
      .in('visit_id', dueVisitIds)
      .in('status', ['unpaid', 'partial'])
      .order('invoice_date', { ascending: true });

    for (const invoice of outstanding ?? []) {
      if (invoice.balance <= 0) continue;
      if (dues[invoice.visit_id]) continue;
      dues[invoice.visit_id] = {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoice_no,
        patientName: invoice.patient_name_snapshot,
        balance: invoice.balance,
      };
    }
  }

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
        dues={dues}
        canCollect={session.access.permissions.has('billing.collect')}
      />
    </div>
  );
}

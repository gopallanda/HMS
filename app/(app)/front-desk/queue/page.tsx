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
  const { data, error } = await supabase
    .from('visit_queue')
    .select(
      'id, visit_no, token_no, visit_type, status, visited_at, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, doctor_name, department_name, charge_total',
    )
    .eq('hospital_id', session.hospitalId)
    .eq('visit_date', today)
    .order('token_no');

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

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Queue"
        description={`Tokens issued today, ${formatDate(today)}.`}
        actions={
          <Button asChild>
            <Link href="/front-desk/register">Register patient</Link>
          </Button>
        }
      />
      <QueueBoard entries={entries} hospitalId={session.hospitalId} />
    </div>
  );
}

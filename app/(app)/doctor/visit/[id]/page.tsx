import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ConsultationScreen } from './consultation-screen';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatTime } from '@/lib/utils/dates';

export const metadata = { title: 'Consultation' };

/**
 * One visit, open in front of the doctor.
 *
 * Everything the screen needs is read here, on the server, through RLS: the
 * visit and its patient from visit_queue, the patient's earlier visits, and
 * the consultation record if one has been started. The client component below
 * is a form, not a data layer.
 */
export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: visit, error } = await supabase
    .from('visit_queue')
    .select(
      'id, visit_no, token_no, visit_type, status, visited_at, patient_id, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, doctor_id, doctor_name, department_name',
    )
    .eq('hospital_id', session.hospitalId)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Consultation" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          This visit could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  // Not found, or found in another hospital -- which RLS has already turned
  // into not found. Either way there is nothing here to show.
  if (!visit) notFound();

  const [history, consultation] = await Promise.all([
    // Past visits, most recent first. The current one is excluded: it is the
    // heading of this page, not a line in its own history. Read from
    // visit_queue rather than visits so the doctor's name comes with it -- the
    // useful part of "when were they last here" is usually who saw them.
    //
    // Ten is a screenful. A full history is a later phase, and it belongs on
    // the patient rather than on one visit.
    supabase
      .from('visit_queue')
      .select('id, visit_no, visited_at, visit_type, status, doctor_name, department_name')
      .eq('hospital_id', session.hospitalId)
      .eq('patient_id', visit.patient_id)
      .neq('id', visit.id)
      .order('visited_at', { ascending: false })
      .limit(10),
    supabase
      .from('consultations')
      .select('*')
      .eq('hospital_id', session.hospitalId)
      .eq('visit_id', visit.id)
      .maybeSingle(),
  ]);

  /**
   * If the existing record could not be read, the form must NOT open.
   *
   * A blank form on a visit that already has notes is not a cosmetic problem:
   * save_consultation replaces the vitals and the notes rather than merging
   * them, so the next save would blank what is already written. Refusing to
   * render is the only safe answer, and the doctor is told why (CLAUDE.md 7).
   */
  if (consultation.error) {
    return (
      <div className="grid gap-6">
        <PageHeader title={visit.patient_name} description={visit.visit_no} />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The notes already on this visit could not be read, so the form is not being opened --
          saving now could overwrite them. {consultation.error.message}
        </p>
        <Button asChild variant="outline" className="justify-self-start">
          <Link href="/doctor/queue">
            <ArrowLeftIcon data-icon="inline-start" />
            My queue
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title={visit.patient_name}
        description={`${visit.visit_no} · Token ${visit.token_no} · ${formatDate(
          visit.visited_at,
        )} ${formatTime(visit.visited_at)}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/doctor/queue">
              <ArrowLeftIcon data-icon="inline-start" />
              My queue
            </Link>
          </Button>
        }
      />
      <ConsultationScreen
        visit={visit}
        /* null means the history could not be read -- which the panel says out
           loud, because "no past visits" and "we could not check" look the
           same on a chart and mean opposite things. It is not a reason to
           withhold the form: unlike the record itself, nothing is written back
           from this list. */
        history={history.error ? null : (history.data ?? [])}
        consultation={consultation.data ?? null}
        /**
         * Whether the doctor is looking at their own patient. The rule is
         * enforced in save_consultation, which is what makes it true; this
         * only decides whether the form is worth offering (CLAUDE.md 5).
         */
        readOnly={
          session.role === 'doctor' &&
          visit.doctor_id !== null &&
          visit.doctor_id !== session.staffId
        }
      />
    </div>
  );
}

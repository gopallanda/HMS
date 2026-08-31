import Link from 'next/link';

import {
  RegisterDesk,
  type DepartmentOption,
  type DeskPatient,
  type DoctorOption,
} from './register-desk';
import { AccessDenied } from '@/components/shell/access-denied';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { todayIst } from '@/lib/utils/dates';

export const metadata = { title: 'Register patient' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const { patient: patientId } = await searchParams;
  const session = await requireSession();

  if (!session.access.permissions.has('visits.create')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="Registration"
        audience="reception staff"
      />
    );
  }

  const supabase = await createClient();
  const today = todayIst();

  // Four small reads, in parallel. The doctor list, the departments, today's
  // roster and today's queue counts are all tiny and change slowly; the patient
  // search is the only thing that talks to the database while someone types.
  const [doctorResult, departmentResult, shiftResult, queueResult] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name, department_id, consultation_fee')
      .eq('hospital_id', session.hospitalId)
      .eq('role', 'doctor')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('departments')
      .select('id, name')
      .eq('hospital_id', session.hospitalId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('staff_shifts')
      .select('staff_id, status')
      .eq('hospital_id', session.hospitalId)
      .eq('work_date', today),
    supabase
      .from('visit_queue')
      .select('doctor_id, status')
      .eq('hospital_id', session.hospitalId)
      .eq('visit_date', today),
  ]);

  const failed = doctorResult.error ?? departmentResult.error;
  if (failed) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Register patient" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The desk could not be loaded: {failed.message}
        </p>
      </div>
    );
  }

  /**
   * Who is on duty today.
   *
   * A shift row saying scheduled or present is on duty; absent, day_off and
   * leave are not. A hospital that keeps NO roster for today gets every active
   * doctor marked on duty rather than an empty list -- most small hospitals do
   * not roster their doctors at all, and a screen that refuses to register
   * anybody because nobody filled in a grid is a screen nobody will use.
   */
  const roster = shiftResult.data ?? [];
  const rosterKept = roster.length > 0;
  const onDuty = new Set(
    roster
      .filter((row) => row.status === 'scheduled' || row.status === 'present')
      .map((row) => row.staff_id),
  );

  // How many are still waiting for each doctor. The number beside the name is
  // what stops the desk sending the eleventh patient to the doctor who already
  // has ten while their colleague has none.
  const waiting = new Map<string, number>();
  for (const row of queueResult.data ?? []) {
    if (!row.doctor_id) continue;
    if (row.status !== 'waiting' && row.status !== 'in_consultation') continue;
    waiting.set(row.doctor_id, (waiting.get(row.doctor_id) ?? 0) + 1);
  }

  const doctors: DoctorOption[] = (doctorResult.data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    department_id: row.department_id,
    consultation_fee: Number(row.consultation_fee ?? 0),
    waiting: waiting.get(row.id) ?? 0,
    on_duty: rosterKept ? onDuty.has(row.id) : true,
  }));

  // Rostered doctors first, so the common choice is the top of the list. Not
  // filtered: a doctor who came in unrostered still sees patients, and a desk
  // that cannot register for them would simply be wrong.
  doctors.sort((a, b) => Number(b.on_duty) - Number(a.on_duty) || a.full_name.localeCompare(b.full_name));

  const departments: DepartmentOption[] = departmentResult.data ?? [];

  /**
   * ?patient=<id> -- the deep link from a patient record's "New visit".
   *
   * A miss is not an error: the desk still works, the only thing lost is the
   * head start. A soft-deleted patient is a miss on purpose, because the RPC
   * refuses one and offering it anyway walks the clerk into that refusal.
   */
  const initialPatient = patientId
    ? await loadPatient(supabase, session.hospitalId, patientId)
    : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Register patient"
        description="Search first. One form: patient, doctor, fee and token together."
        actions={
          <Button asChild variant="outline">
            <Link href="/front-desk/queue">Today&apos;s queue</Link>
          </Button>
        }
      />

      {doctors.length === 0 ? (
        // Registration allocates a token in a doctor's queue and bills their
        // fee. Saying so here beats an empty dropdown three sections down.
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          No active doctors yet, so nobody can be registered.{' '}
          {session.access.permissions.has('staff.create') ? (
            <Link href="/admin/staff" className="font-medium underline underline-offset-4">
              Add a doctor and their consultation fee
            </Link>
          ) : (
            'Ask an administrator to add one.'
          )}
        </p>
      ) : null}

      <RegisterDesk
        doctors={doctors}
        departments={departments}
        initialPatient={initialPatient}
        canEditFee={session.access.permissions.has('billing.collect')}
        canDefer={session.access.permissions.has('billing.defer')}
      />
    </div>
  );
}

async function loadPatient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hospitalId: string,
  id: string,
): Promise<DeskPatient | null> {
  const { data } = await supabase
    .from('patients')
    .select('id, mrn, full_name, dob, gender, phone, deleted_at')
    .eq('hospital_id', hospitalId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    mrn: data.mrn,
    full_name: data.full_name,
    dob: data.dob,
    gender: data.gender,
    phone: data.phone,
  };
}

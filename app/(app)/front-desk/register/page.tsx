import Link from 'next/link';

import {
  RegisterDesk,
  type DepartmentOption,
  type DeskPatient,
  type DoctorOption,
} from './register-desk';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { isAdminRole } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Register patient' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const { patient: patientId } = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Both lists are small and change rarely, so they are fetched once on the
  // server and handed to the desk. The patient search is the only thing that
  // talks to the database while someone is typing.
  const [doctorResult, departmentResult] = await Promise.all([
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

  const doctors: DoctorOption[] = doctorResult.data ?? [];
  const departments: DepartmentOption[] = departmentResult.data ?? [];

  /**
   * ?patient=<id> -- the deep link from a patient record's "New visit".
   *
   * A miss is not an error here. The desk still works exactly as it always
   * does; the only thing lost is the head start, so a stale link opens the
   * search box rather than an apology. A soft-deleted patient is a miss on
   * purpose -- create_visit refuses one, and offering the dialog anyway would
   * walk the operator into that refusal.
   */
  const initialPatient = patientId ? await loadPatient(supabase, session.hospitalId, patientId) : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Register patient"
        description="Search first. Register only when nobody matches."
        actions={
          <Button asChild variant="outline">
            <Link href="/front-desk/queue">Today&apos;s queue</Link>
          </Button>
        }
      />

      {doctors.length === 0 ? (
        // A visit needs a doctor, and the consultation charge comes from that
        // doctor's fee. Saying so here beats an empty dropdown three clicks in.
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          No active doctors yet, so a visit cannot be started.{' '}
          {isAdminRole(session.role) ? (
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

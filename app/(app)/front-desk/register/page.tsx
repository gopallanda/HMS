import Link from 'next/link';

import { RegisterDesk, type DepartmentOption, type DoctorOption } from './register-desk';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { isAdminRole } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Register patient' };

export default async function RegisterPage() {
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
      <div className="grid gap-4">
        <PageHeader title="Register patient" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The desk could not be loaded: {failed.message}
        </p>
      </div>
    );
  }

  const doctors: DoctorOption[] = doctorResult.data ?? [];
  const departments: DepartmentOption[] = departmentResult.data ?? [];

  return (
    <div className="grid gap-3">
      <PageHeader
        title="Register patient"
        description="Search first. Register only when nobody matches."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/front-desk/queue">Today&apos;s queue</Link>
          </Button>
        }
      />

      {doctors.length === 0 ? (
        // A visit needs a doctor, and the consultation charge comes from that
        // doctor's fee. Saying so here beats an empty dropdown three clicks in.
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          No active doctors yet, so a visit cannot be started.{' '}
          {isAdminRole(session.role) ? (
            <Link href="/admin/staff" className="underline underline-offset-2">
              Add a doctor and their consultation fee
            </Link>
          ) : (
            'Ask an administrator to add one.'
          )}
        </p>
      ) : null}

      <RegisterDesk doctors={doctors} departments={departments} />
    </div>
  );
}

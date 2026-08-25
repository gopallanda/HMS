import { StaffTable, type DepartmentOption, type StaffRow } from './staff-table';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Staff' };

export default async function StaffPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [staffResult, departmentResult] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name, role, department_id, phone, reg_no, consultation_fee, is_active, user_id')
      .eq('hospital_id', session.hospitalId)
      .order('is_active', { ascending: false })
      .order('full_name'),
    supabase
      .from('departments')
      .select('id, name, is_active')
      .eq('hospital_id', session.hospitalId)
      .order('name'),
  ]);

  const failed = staffResult.error ?? departmentResult.error;
  if (failed) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Staff" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          Staff could not be loaded: {failed.message}
        </p>
      </div>
    );
  }

  const staff: StaffRow[] = staffResult.data ?? [];
  const departments: DepartmentOption[] = departmentResult.data ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Staff"
        description="People who work here. A staff record is not a login."
      />
      <StaffTable staff={staff} departments={departments} />
    </div>
  );
}

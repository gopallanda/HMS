import { DepartmentsTable, type DepartmentRow } from './departments-table';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Departments' };

export default async function DepartmentsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // Inactive departments are listed too, greyed out: they still appear on old
  // visits, and hiding them makes a reactivation impossible to find.
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, code, is_active')
    .eq('hospital_id', session.hospitalId)
    .order('is_active', { ascending: false })
    .order('name');

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Departments" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          Departments could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  const departments: DepartmentRow[] = data ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Departments"
        description="Used by staff records now, and by visits and charges in Phase 1."
      />
      <DepartmentsTable departments={departments} />
    </div>
  );
}

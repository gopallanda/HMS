import { RosterGrid, type RosterDepartment, type RosterPerson, type ShiftCell } from './roster-grid';
import { AccessDenied } from '@/components/shell/access-denied';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Roster' };

/** 'YYYY-MM' -> the first and last day of that month, as 'YYYY-MM-DD'. */
function monthBounds(month: string): { first: string; last: string; days: number } {
  const [year, index] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return {
    first: `${month}-01`,
    last: `${month}-${String(days).padStart(2, '0')}`,
    days,
  };
}

/** Today in IST, which is the only "today" this product has (lib/utils/dates). */
function currentMonth(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();

  if (!session.access.permissions.has('roster.read')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="The roster"
        audience="managers"
      />
    );
  }

  const params = await searchParams;
  const requested = typeof params.month === 'string' ? params.month : '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentMonth();
  const departmentFilter =
    typeof params.department === 'string' && params.department !== '' ? params.department : null;

  const { first, last, days } = monthBounds(month);

  const supabase = await createClient();

  const staffQuery = supabase
    .from('staff')
    .select('id, full_name, department_id, employee_code, role_id, employment_type')
    .eq('hospital_id', session.hospitalId)
    .eq('is_active', true)
    .order('full_name');

  const [staffResult, departmentResult, roleResult, shiftResult] = await Promise.all([
    departmentFilter ? staffQuery.eq('department_id', departmentFilter) : staffQuery,
    supabase
      .from('departments')
      .select('id, name')
      .eq('hospital_id', session.hospitalId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('roles')
      .select('id, name')
      .eq('hospital_id', session.hospitalId)
      .is('deleted_at', null),
    supabase
      .from('staff_shifts')
      .select('id, staff_id, work_date, status, start_time, end_time, hours, notes')
      .eq('hospital_id', session.hospitalId)
      .gte('work_date', first)
      .lte('work_date', last),
  ]);

  const failed = staffResult.error ?? departmentResult.error ?? shiftResult.error;
  if (failed) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Roster" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The roster could not be loaded: {failed.message}
        </p>
      </div>
    );
  }

  const roleName = new Map((roleResult.data ?? []).map((role) => [role.id, role.name]));

  const people: RosterPerson[] = (staffResult.data ?? []).map((person) => ({
    id: person.id,
    full_name: person.full_name,
    employee_code: person.employee_code,
    role_name: roleName.get(person.role_id) ?? 'Unknown',
    department_id: person.department_id,
  }));

  const departments: RosterDepartment[] = departmentResult.data ?? [];
  const shifts: ShiftCell[] = shiftResult.data ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Roster"
        description="Who worked which day. Applies to everybody on the staff list, including the roles that never sign in."
      />
      <RosterGrid
        month={month}
        days={days}
        people={people}
        departments={departments}
        departmentFilter={departmentFilter}
        shifts={shifts}
        canWrite={session.access.permissions.has('roster.write')}
      />
    </div>
  );
}

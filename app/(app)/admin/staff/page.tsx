import {
  StaffTable,
  type AccountRow,
  type DepartmentOption,
  type RoleOption,
  type StaffRow,
} from './staff-table';
import { AccessDenied } from '@/components/shell/access-denied';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Staff' };

export default async function StaffPage() {
  const session = await requireSession();

  if (!session.access.permissions.has('staff.read')) {
    return <AccessDenied roleName={roleDisplayName(session)} area="Staff" />;
  }

  const supabase = await createClient();

  const [staffResult, roleResult, departmentResult, accountResult] = await Promise.all([
    supabase
      .from('staff')
      .select(
        'id, full_name, role_id, department_id, phone, reg_no, consultation_fee, is_active, user_id, can_login, employee_code, employment_type',
      )
      .eq('hospital_id', session.hospitalId)
      .order('is_active', { ascending: false })
      .order('full_name'),
    supabase
      .from('roles')
      .select('id, code, name, can_login')
      .eq('hospital_id', session.hospitalId)
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, is_active')
      .eq('hospital_id', session.hospitalId)
      .order('name'),
    // Visible to administrators only, by policy. A staff member without the
    // permission simply gets an empty list and no credentials column, rather
    // than an error -- the page is still useful to them.
    supabase
      .from('staff_accounts')
      .select('id, staff_id, username, contact_email, disabled_at, must_change_password, last_login_at')
      .eq('hospital_id', session.hospitalId),
  ]);

  const failed = staffResult.error ?? roleResult.error ?? departmentResult.error;
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
  const roles: RoleOption[] = roleResult.data ?? [];
  const departments: DepartmentOption[] = departmentResult.data ?? [];
  const accounts: AccountRow[] = accountResult.data ?? [];

  const permissions = session.access.permissions;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Staff"
        description="Everyone who works here. A staff record is not a login -- roles like Cleaner never get one, and still get a roster."
      />
      <StaffTable
        staff={staff}
        roles={roles}
        departments={departments}
        accounts={accounts}
        can={{
          create: permissions.has('staff.create'),
          update: permissions.has('staff.update'),
          deactivate: permissions.has('staff.deactivate'),
          provision: permissions.has('accounts.provision'),
          resetPassword: permissions.has('accounts.reset_password'),
        }}
      />
    </div>
  );
}

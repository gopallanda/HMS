import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession } from '@/lib/auth/session';
import { isAdminRole } from '@/lib/roles';

/**
 * Gate for /admin.
 *
 * This hides the screens; it does not protect the data. The RLS policies in
 * 20260818090100_jwt_helpers_and_rls.sql only allow writes to departments,
 * staff and the hospitals row when the JWT says admin, so a doctor who forges
 * a request past this layout still gets nothing (CLAUDE.md 5).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!isAdminRole(session.role)) {
    return <AccessDenied role={session.role} area="Administration" />;
  }

  return children;
}

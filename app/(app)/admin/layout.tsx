import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { hasAnyPermission } from '@/lib/rbac/access';

/**
 * Gate for /admin.
 *
 * Second of the three layers (CLAUDE.md 3.6). The proxy already turned away
 * anyone whose permissions do not match ROUTE_PERMISSIONS for the exact path;
 * this catches a screen added under /admin that nobody remembered to map, so a
 * new administration page is refused by default rather than open by default.
 *
 * ANY of the administration permissions gets past this layout, because /admin
 * is a section rather than a screen: a Manager holds staff.read and
 * roster.read and no settings.manage, and must still reach their half of it.
 * Each page below re-checks the one permission it actually needs.
 *
 * Neither layer protects the data. The RLS policies in
 * 20260818090100_jwt_helpers_and_rls.sql only allow writes to departments,
 * staff and the hospitals row when the JWT says admin, so a doctor who forges
 * a request past this layout still gets nothing (CLAUDE.md 5).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  const allowed = hasAnyPermission(
    session.access,
    'settings.manage',
    'roles.manage',
    'departments.manage',
    'staff.read',
    'roster.read',
  );

  if (!allowed) {
    return <AccessDenied roleName={roleDisplayName(session)} area="Administration" />;
  }

  return children;
}

import { requireSession } from '@/lib/auth/session';
import type { Permission } from '@/lib/rbac/permissions';

/**
 * Hide a button somebody cannot use.
 *
 * COSMETIC, and it is worth being blunt about that (CLAUDE.md 3.6). This is
 * the third of the three layers and the only one that protects nothing: a
 * nurse must not be shown "Add staff", but what stops her adding staff is
 * requirePermission() at the top of the action and the RLS policy under it. A
 * <Can> around a form with no check inside the action is a permission bug
 * wearing a permission check.
 *
 * Server Component on purpose. The permission set is already on the session
 * for this request, so there is nothing to fetch and nothing to send to the
 * browser.
 *
 *   <Can permission="staff.create">
 *     <NewStaffButton />
 *   </Can>
 *
 * `any` takes several keys and renders when the viewer holds one of them.
 */
export async function Can({
  permission,
  any,
  fallback = null,
  children,
}: {
  permission?: Permission;
  any?: readonly Permission[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const held = session.access.permissions;

  const keys = permission ? [permission, ...(any ?? [])] : (any ?? []);
  const allowed = keys.length === 0 || keys.some((key) => held.has(key));

  return allowed ? <>{children}</> : <>{fallback}</>;
}

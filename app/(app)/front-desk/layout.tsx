import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { hasAnyPermission } from '@/lib/rbac/access';

/**
 * Gate for /front-desk.
 *
 * visits.create OR queue.read: registration and the queue are one desk, but a
 * hospital may well let a nurse watch the queue without letting her register
 * anybody. Each page re-checks the one it needs.
 *
 * Second of the three layers, and it does not protect the data.
 * register_patient and create_visit run their own role check in Postgres
 * (public.assert_front_desk), so a pharmacist who POSTs straight at the Server
 * Action still gets nothing (CLAUDE.md 5).
 */
export default async function FrontDeskLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!hasAnyPermission(session.access, 'visits.create', 'queue.read')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="The front desk"
        audience="reception staff"
      />
    );
  }

  return children;
}

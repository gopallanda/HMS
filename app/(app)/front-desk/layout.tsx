import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession } from '@/lib/auth/session';
import { isFrontDeskRole } from '@/lib/roles';

/**
 * Gate for /front-desk.
 *
 * Same arrangement as /admin: this hides the screens, it does not protect the
 * data. register_patient and create_visit run their own role check in
 * Postgres (public.assert_front_desk), so a pharmacist who POSTs straight at
 * the Server Action still gets nothing (CLAUDE.md 5).
 */
export default async function FrontDeskLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!isFrontDeskRole(session.role)) {
    return <AccessDenied role={session.role} area="The front desk" audience="reception staff" />;
  }

  return children;
}

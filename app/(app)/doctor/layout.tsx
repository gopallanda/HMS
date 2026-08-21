import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession } from '@/lib/auth/session';
import { isClinicalRole } from '@/lib/roles';

/**
 * Gate for /doctor.
 *
 * Same arrangement as /admin, /front-desk and /billing: this hides the
 * screens, it does not protect the record. save_consultation runs its own
 * role check in Postgres (public.assert_clinical) and refuses a doctor writing
 * on another doctor's visit, and consultations carries an RLS policy that
 * restricts even reading a note to clinical roles -- so a cashier who POSTs
 * straight at the Server Action still gets nothing (CLAUDE.md 5).
 *
 * The gate matches assert_clinical rather than the narrower set the sidebar
 * links for, so it never denies someone the database would have allowed. A
 * nurse who types the URL reaches the queue and is told it is a doctor's
 * queue; she is not shown a permission error for something she may do.
 */
export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!isClinicalRole(session.role)) {
    return <AccessDenied role={session.role} area="The doctor desk" audience="clinical staff" />;
  }

  return children;
}

import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/access';

/**
 * Gate for /doctor.
 *
 * consultation.read, not .write. A nurse takes vitals before the doctor sees
 * the patient and reads the note afterwards; refusing her the queue would be
 * denying her something the database would have allowed. The narrower rule --
 * a DOCTOR may only write on the visits booked to them -- lives in
 * save_consultation, because it depends on the visit, not on the role.
 *
 * Second of the three layers, and it does not protect the record.
 * save_consultation runs its own check in Postgres (public.assert_clinical),
 * and consultations carries an RLS policy that restricts even reading a note
 * to clinical roles -- so a cashier who POSTs straight at the Server Action
 * still gets nothing (CLAUDE.md 5).
 */
export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!hasPermission(session.access, 'consultation.read')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="The doctor desk"
        audience="clinical staff"
      />
    );
  }

  return children;
}

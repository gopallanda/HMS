import { PatientSearchScreen } from './patient-search-screen';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { isFrontDeskRole } from '@/lib/roles';

export const metadata = { title: 'Patients' };

/**
 * The way into a patient record.
 *
 * Search-first, like registration and for the same reason (CLAUDE.md 3.3):
 * there is no list of every patient in the hospital worth paginating through,
 * and the question staff actually arrive with is "where is this one person".
 *
 * No data is read here. The search runs in the browser against
 * search_patients, so the results follow the operator's typing rather than a
 * round trip through a Server Component on every keystroke.
 */
export default async function PatientsPage() {
  const session = await requireSession();

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Patients"
        description="Phone, name or MRN. The record carries visits, bills and notes."
      />
      <PatientSearchScreen canRegister={isFrontDeskRole(session.role)} />
    </div>
  );
}

import { PatientSearchScreen } from './patient-search-screen';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { recentPatients } from '@/lib/rpc/patients';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Patients' };

/**
 * The way into a patient record.
 *
 * Search-first, like registration and for the same reason (CLAUDE.md 3.3):
 * there is no list of every patient in the hospital worth paginating through,
 * and the question staff actually arrive with is "where is this one person".
 *
 * The SEARCH runs in the browser against search_patients, so the results
 * follow the operator's typing rather than a round trip through a Server
 * Component on every keystroke.
 *
 * The resting state does not. recent_patients is read here, once, and handed
 * down: it is what the screen shows before anybody types, and asking for it
 * from the client would mean the first paint of the patients module is
 * reliably empty -- which is exactly the thing this fixes (defect 4). A failed
 * read is passed as null rather than as an empty list, because "nobody has
 * been here" and "the list could not be loaded" are different sentences and
 * the screen says both (CLAUDE.md 7).
 */
export default async function PatientsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: recent, error } = await recentPatients(supabase);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Patients"
        description="Phone, name or MRN. The record carries visits, bills and notes."
      />
      <PatientSearchScreen
        canRegister={session.access.permissions.has('visits.create')}
        recent={error ? null : (recent ?? [])}
      />
    </div>
  );
}

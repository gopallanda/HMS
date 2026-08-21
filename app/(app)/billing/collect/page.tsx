import Link from 'next/link';

import { CollectDesk, type BillingVisit, type ServiceOption } from './collect-desk';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayIst } from '@/lib/utils/dates';

export const metadata = { title: 'Collect payment' };

/**
 * The billing counter.
 *
 * Opens on today's visits, because that is who is standing there. The charge
 * master is small and changes rarely, so it is fetched once here and handed to
 * the desk; the only thing that talks to the database while somebody is typing
 * is the pending-charges read for the selected visit.
 */
export default async function CollectPage({
  searchParams,
}: {
  searchParams: Promise<{ visit?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const { visit } = await searchParams;

  // Today in IST, never the server's timezone: a box in Washington would show
  // yesterday's counter for the first five and a half hours of the day.
  const today = todayIst();

  const [visitResult, serviceResult] = await Promise.all([
    // visit_billing is a security_invoker view, so RLS still scopes this to the
    // caller's hospital. The hospital_id filter is here anyway, because a query
    // that only works because of a policy is a query nobody can read.
    supabase
      .from('visit_billing')
      .select(
        'visit_id, visit_no, token_no, visit_type, visit_status, visited_at, patient_id, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, doctor_name, department_name, pending_count, pending_total, invoiced_total, invoice_count',
      )
      .eq('hospital_id', session.hospitalId)
      .eq('visit_date', today)
      .neq('visit_status', 'cancelled')
      .order('token_no'),
    supabase
      .from('services')
      .select('id, name, category, price, tax_rate')
      .eq('hospital_id', session.hospitalId)
      .eq('is_active', true)
      .order('category')
      .order('name'),
  ]);

  const failed = visitResult.error ?? serviceResult.error;
  if (failed) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Collect payment" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The counter could not be loaded: {failed.message}
        </p>
      </div>
    );
  }

  const visits: BillingVisit[] = visitResult.data ?? [];
  const services: ServiceOption[] = serviceResult.data ?? [];

  return (
    <div className="grid gap-3">
      <PageHeader
        title="Collect payment"
        description={`${formatDate(today)} - ${visits.filter((v) => v.pending_count > 0).length} of ${visits.length} visits still to bill`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/billing/invoices">Invoices</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/billing/day-close">Day close</Link>
            </Button>
          </>
        }
      />

      {services.length === 0 ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The charge master is empty, so no charge can be added at the counter. An administrator
          has to add services before billing works.
        </p>
      ) : null}

      <CollectDesk
        visits={visits}
        services={services}
        hospitalId={session.hospitalId}
        selectedVisitId={visit ?? null}
      />
    </div>
  );
}

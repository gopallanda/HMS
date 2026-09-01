import { ServicesTable, type DoctorFee, type ServiceRow } from './services-table';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Price list' };

export default async function ServicesPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // Two small reads in parallel.
  //
  // Inactive services are listed too, greyed out: they still appear on old
  // charge lines, and hiding them makes a reactivation impossible to find --
  // the same rule the departments screen follows.
  //
  // The doctors come along because the consultation rows are otherwise a lie.
  // register_patient_visit charges staff.consultation_fee, not services.price,
  // so an owner who edits "Consultation - OPD" to 600 and watches bills stay at
  // 500 has found documented behaviour and will report it as a bug. Showing the
  // fees that are ACTUALLY charged, beside the row, ends that in one glance --
  // and surfaces the worse case, a doctor still sitting on a fee of zero.
  const [{ data, error }, doctorResult] = await Promise.all([
    supabase
      .from('services')
      .select('id, name, category, unit, price, tax_rate, is_active')
      .eq('hospital_id', session.hospitalId)
      .order('category')
      .order('name'),
    supabase
      .from('staff')
      .select('id, full_name, consultation_fee')
      .eq('hospital_id', session.hospitalId)
      .eq('role', 'doctor')
      .eq('is_active', true)
      .order('full_name'),
  ]);

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Price list" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The price list could not be loaded: {error.message}
        </p>
      </div>
    );
  }

  const services: ServiceRow[] = data ?? [];

  // A failed doctor read is not worth an error page: it costs the consultation
  // rows their fee line and nothing else on this screen.
  const doctors: DoctorFee[] = (doctorResult.data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    consultation_fee: Number(row.consultation_fee ?? 0),
  }));

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Price list"
        description="The charge master. One row per billable thing — a category is the folder it sits in, never a rate of its own."
      />
      <ServicesTable services={services} doctors={doctors} />
    </div>
  );
}

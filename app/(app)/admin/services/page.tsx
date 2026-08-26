import { ServicesTable, type ServiceRow } from './services-table';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Price list' };

export default async function ServicesPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // Inactive services are listed too, greyed out: they still appear on old
  // charge lines, and hiding them makes a reactivation impossible to find --
  // the same rule the departments screen follows.
  const { data, error } = await supabase
    .from('services')
    .select('id, name, category, price, tax_rate, is_active')
    .eq('hospital_id', session.hospitalId)
    .order('category')
    .order('name');

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

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Price list"
        description="The charge master. Every line on a bill starts here — and keeps the price it was raised at."
      />
      <ServicesTable services={services} />
    </div>
  );
}

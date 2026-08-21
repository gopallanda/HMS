import { SettingsForm } from './settings-form';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/lib/auth/session';

export const metadata = { title: 'Hospital settings' };

export default async function HospitalSettingsPage() {
  // requireSession already loaded and verified the hospitals row, so this page
  // does not query for it a second time.
  const session = await requireSession();

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Hospital settings"
        description="Branding and statutory details used on every printed document."
      />
      <SettingsForm hospital={session.hospital} />
    </div>
  );
}

import type { Metadata } from 'next';

import { PortalPage } from '../portal-page';

export const metadata: Metadata = {
  title: 'Staff sign in',
};

export default function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PortalPage portal="staff" searchParams={searchParams} />;
}

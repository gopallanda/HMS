import type { Metadata } from 'next';

import { PortalPage } from '../portal-page';

export const metadata: Metadata = {
  title: 'Doctor sign in',
};

export default function DoctorLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PortalPage portal="doctor" searchParams={searchParams} />;
}

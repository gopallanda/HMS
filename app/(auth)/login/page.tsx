import type { Metadata } from 'next';

import { PortalPage } from './portal-page';

export const metadata: Metadata = {
  title: 'Admin sign in',
};

/** The admin door. Also where every bare /login redirect lands. */
export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PortalPage portal="admin" searchParams={searchParams} />;
}

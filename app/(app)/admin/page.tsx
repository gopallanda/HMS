import { redirect } from 'next/navigation';

/** /admin has no screen of its own; settings is the first thing anyone sets up. */
export default function AdminIndexPage() {
  redirect('/admin/settings');
}

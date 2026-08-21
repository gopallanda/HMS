import { requireSession } from '@/lib/auth/session';

/**
 * Shell for anything that goes on paper.
 *
 * Deliberately outside /(app): no sidebar, no page chrome, nothing that would
 * end up on an 80mm roll. Still behind requireSession, because a receipt names
 * a patient and an amount.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return children;
}

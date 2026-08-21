import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession } from '@/lib/auth/session';
import { isBillingRole } from '@/lib/roles';

/**
 * Gate for /billing.
 *
 * Same arrangement as /admin and /front-desk: this hides the screens, it does
 * not protect the money. collect_payment and void_invoice run their own role
 * check in Postgres (public.assert_billing), and invoices and payments carry
 * an RLS policy that restricts even reading them -- so a nurse who POSTs
 * straight at the Server Action still gets nothing (CLAUDE.md 5).
 */
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!isBillingRole(session.role)) {
    return <AccessDenied role={session.role} area="Billing" audience="billing staff" />;
  }

  return children;
}

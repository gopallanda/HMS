import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { hasAnyPermission } from '@/lib/rbac/access';

/**
 * Gate for /billing.
 *
 * billing.read OR reports.view: the day close is a report, and an accountant
 * who reconciles but never collects still has to be able to open it.
 *
 * Second of the three layers, and it does not protect the money.
 * collect_payment and void_invoice run their own role check in Postgres
 * (public.assert_billing), and invoices and payments carry an RLS policy that
 * restricts even reading them -- so a nurse who POSTs straight at the Server
 * Action still gets nothing (CLAUDE.md 5).
 */
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (!hasAnyPermission(session.access, 'billing.read', 'reports.view')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="Billing"
        audience="billing staff"
      />
    );
  }

  return children;
}

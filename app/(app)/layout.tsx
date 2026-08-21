import { AppSidebar } from '@/components/shell/app-sidebar';
import { QueryProvider } from '@/components/shell/query-provider';
import { requireSession } from '@/lib/auth/session';

/**
 * The signed-in shell.
 *
 * requireSession() runs here, so every page beneath this layout can assume a
 * verified user with a hospital claim. It is a convenience, not the security
 * boundary: RLS in Postgres is (CLAUDE.md 5), and each Server Action re-checks
 * for itself because actions are reachable by POST without passing through any
 * layout at all.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    // QueryProvider is a client boundary, but `children` is passed through it
    // as a prop, so pages beneath stay Server Components.
    <QueryProvider>
      <div className="flex min-h-svh flex-1">
        <AppSidebar
          role={session.role}
          hospitalName={session.hospital.name}
          logoUrl={session.hospital.logo_url}
          userName={session.staffName}
          userEmail={session.email}
        />
        <main className="min-w-0 flex-1 px-4 py-4 md:px-6">{children}</main>
      </div>
    </QueryProvider>
  );
}

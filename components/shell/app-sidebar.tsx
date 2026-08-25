'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { HospitalMark } from '@/components/shell/hospital-mark';
import { UserMenu } from '@/components/shell/user-menu';
import { cn } from '@/lib/cn';
import { navFor, type NavItem } from '@/lib/nav';
import type { AppRole } from '@/lib/roles';

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A module the signed-in role may reach. Planned modules render in the same
 * place, greyed out and tagged with their phase, rather than disappearing --
 * a cashier who cannot find billing assumes it is broken, not unbuilt
 * (CLAUDE.md 1).
 */
function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const base =
    'flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors md:px-2.5';

  if (item.status === 'planned') {
    return (
      <span
        className={cn(base, 'cursor-default text-muted-foreground/60')}
        title={`Phase ${item.phase} — not built yet`}
      >
        <Icon className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate md:block">{item.label}</span>
        <span className="hidden rounded bg-muted px-1 text-xs font-medium text-muted-foreground md:block">
          P{item.phase}
        </span>
      </span>
    );
  }

  const current = isCurrent(pathname, item.href);

  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        base,
        current
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="hidden flex-1 truncate md:block">{item.label}</span>
    </Link>
  );
}

export function AppSidebar({
  role,
  hospitalName,
  logoUrl,
  userName,
  userEmail,
}: {
  role: AppRole;
  hospitalName: string;
  logoUrl: string | null;
  userName: string | null;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const sections = navFor(role);

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:w-56">
      <div className="flex items-center gap-2 px-2 py-2.5 md:px-3">
        <HospitalMark name={hospitalName} logoUrl={logoUrl} size={28} />
        <span className="hidden min-w-0 flex-1 md:block">
          <span className="block truncate text-sm font-semibold" title={hospitalName}>
            {hospitalName}
          </span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-2 md:px-2">
        {sections.map((section) => (
          <div key={section.label} className="mb-2">
            <p className="hidden px-2.5 py-1 text-xs font-medium text-muted-foreground md:block">
              {section.label}
            </p>
            <div className="grid gap-0.5">
              {section.items.map((item) => (
                <NavRow key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-1.5 md:p-2">
        <UserMenu name={userName} email={userEmail} role={role} />
      </div>
    </aside>
  );
}

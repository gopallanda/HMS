'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { HospitalMark } from '@/components/shell/hospital-mark';
import { MobileNav } from '@/components/shell/mobile-nav';
import { UserMenu } from '@/components/shell/user-menu';
import { cn } from '@/lib/cn';
import { navFor, type NavItem } from '@/lib/nav';
import { toPermissionSet } from '@/lib/rbac/permissions';

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A module the signed-in role may reach. Planned modules render in the same
 * place, greyed out and tagged with their phase, rather than disappearing --
 * a cashier who cannot find billing assumes it is broken, not unbuilt
 * (CLAUDE.md 1).
 *
 * `showLabels` is a prop rather than a `lg:` utility because the same row is
 * rendered at three widths: icon-only in the tablet rail, labelled in the
 * desktop rail, and labelled again inside the phone drawer -- where the
 * viewport is small but the drawer is wide.
 */
function NavRow({
  item,
  pathname,
  showLabels,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  showLabels: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const base = cn(
    'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors',
    showLabels ? 'px-3 py-2' : 'justify-center px-2 py-2.5',
  );

  if (item.status === 'planned') {
    return (
      <span
        className={cn(base, 'cursor-default text-muted-foreground/60')}
        title={`Phase ${item.phase} — not built yet`}
      >
        <Icon className="size-[18px] shrink-0 stroke-[1.5]" />
        {showLabels ? (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              P{item.phase}
            </span>
          </>
        ) : null}
      </span>
    );
  }

  const current = isCurrent(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      title={showLabels ? undefined : item.label}
      className={cn(
        base,
        current
          ? 'bg-primary/10 font-semibold text-primary'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
      )}
    >
      <Icon className="size-[18px] shrink-0 stroke-[1.5]" />
      {showLabels ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
    </Link>
  );
}

/**
 * The rail's contents: brand, sections, user. Shared verbatim between the
 * fixed desktop rail and the phone drawer, so a nav item can never appear on
 * one and not the other.
 */
function SidebarBody({
  permissions,
  roleName,
  hospitalName,
  logoUrl,
  userName,
  userEmail,
  showLabels,
  onNavigate,
}: {
  permissions: readonly string[];
  roleName: string;
  hospitalName: string;
  logoUrl: string | null;
  userName: string | null;
  userEmail: string | null;
  showLabels: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Rebuilt from the array the server sent: a Set does not survive the RSC
  // boundary as cheaply as a string list, and this runs once per render.
  const sections = navFor(toPermissionSet(permissions));

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2.5 px-3 py-3.5',
          showLabels ? '' : 'justify-center px-2',
        )}
      >
        <HospitalMark name={hospitalName} logoUrl={logoUrl} size={36} />
        {showLabels ? (
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-base leading-tight font-semibold"
              title={hospitalName}
            >
              {hospitalName}
            </span>
          </span>
        ) : null}
      </div>

      <nav
        className={cn(
          'custom-scrollbar flex-1 overflow-y-auto pb-3',
          showLabels ? 'px-2.5' : 'px-2',
        )}
      >
        {sections.map((section) => (
          <div key={section.label}>
            {showLabels ? (
              <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                {section.label}
              </p>
            ) : (
              // In the icon rail there is no room for the word, but the groups
              // still have to read as groups -- otherwise it is one undivided
              // column of nine icons.
              <div className="mx-auto my-2 h-px w-6 bg-sidebar-border first:hidden" />
            )}
            <div className="grid gap-0.5">
              {section.items.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  showLabels={showLabels}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-sidebar-border p-2', showLabels ? '' : 'px-1.5')}>
        <UserMenu name={userName} email={userEmail} roleName={roleName} showLabels={showLabels} />
      </div>
    </>
  );
}

export function AppSidebar(props: {
  /**
   * What the viewer holds, as plain strings.
   *
   * COSMETIC (CLAUDE.md 3.6). Shipping the permission set to the browser
   * discloses nothing -- the holder already knows what they can do, and the
   * proxy and every Server Action re-derive it server-side regardless.
   */
  permissions: readonly string[];
  roleName: string;
  hospitalName: string;
  logoUrl: string | null;
  userName: string | null;
  userEmail: string | null;
}) {
  return (
    <>
      {/* Phone: an app bar and a bottom tab bar instead of the rail. */}
      <MobileNav {...props} />

      {/* Tablet: icons only. Desktop: the full rail. */}
      <aside className="sticky top-0 hidden h-svh w-16 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex lg:w-60">
        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          <SidebarBody {...props} showLabels={false} />
        </div>
        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          <SidebarBody {...props} showLabels />
        </div>
      </aside>
    </>
  );
}

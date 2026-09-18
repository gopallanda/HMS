'use client';

import { LayoutGridIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState, useSyncExternalStore } from 'react';

import { HospitalMark } from '@/components/shell/hospital-mark';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/cn';
import { mobileTabsFor, navFor, type NavItem } from '@/lib/nav';
import { toPermissionSet } from '@/lib/rbac/permissions';

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Four tabs and a More. Five would leave each label ~70px on a 360px phone. */
const TAB_SLOTS = 4;

type ShellProps = {
  permissions: readonly string[];
  roleName: string;
  hospitalName: string;
  logoUrl: string | null;
  userName: string | null;
  userEmail: string | null;
};

/**
 * The phone's chrome: a slim app bar on top, a tab bar at the thumb.
 *
 * Below `md` the side rail would eat the width the work needs, and a drawer
 * behind a hamburger hides the three screens a person opens all day behind two
 * taps each. So the rail becomes a tab bar holding the viewer's most-used
 * destinations (lib/nav.ts decides which, from their permissions), and
 * everything else -- plus who is signed in, the theme and the way out -- lives
 * in one sheet behind More.
 *
 * Nothing here is a control on anybody (CLAUDE.md 3.6): the tabs are the same
 * permission-filtered list the rail renders, and the proxy and the actions
 * re-check regardless.
 */
export function MobileNav(props: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);

  // The layout survives navigation, so a sheet opened on one screen would
  // still be open on the next. Closed during render, not in an effect, so the
  // new page never paints under the old sheet.
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    if (open) setOpen(false);
  }

  const held = toPermissionSet(props.permissions);
  const sections = navFor(held);
  const allReady = sections.flatMap((section) => section.items).filter((i) => i.status === 'ready');
  // Five or fewer destinations all fit; only a longer list needs a More tab.
  const needsMore = allReady.length > TAB_SLOTS + 1;
  const tabs = mobileTabsFor(held, needsMore ? TAB_SLOTS : TAB_SLOTS + 1);
  const onTab = tabs.some((item) => isCurrent(pathname, item.href));
  const section = sections.find((s) => s.items.some((item) => isCurrent(pathname, item.href)));

  const label = props.userName ?? props.userEmail ?? 'Signed in';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <HospitalMark
            name={props.hospitalName}
            logoUrl={props.logoUrl}
            size={34}
            className="rounded-xl"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-semibold tracking-tight">
              {props.hospitalName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {section?.label ?? props.roleName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/15 transition active:scale-95"
            aria-label={`Account: ${label}`}
          >
            {label.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <ul className="mx-auto flex h-16 max-w-lg items-stretch px-1.5">
          {tabs.map((item) => (
            <li key={item.href} className="flex flex-1">
              <TabLink item={item} active={isCurrent(pathname, item.href)} />
            </li>
          ))}
          {needsMore ? (
            <li className="flex flex-1">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex flex-1 flex-col items-center justify-center gap-1 outline-none"
                aria-haspopup="dialog"
              >
                <TabIcon active={open || !onTab}>
                  <LayoutGridIcon className="size-[20px]" strokeWidth={open || !onTab ? 2.1 : 1.7} />
                </TabIcon>
                <TabLabel active={open || !onTab}>More</TabLabel>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="md:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Every module available to you in {props.hospitalName}, your account and appearance.
          </SheetDescription>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
            {/* Who is signed in. On a shared counter phone this is the fact
                people check, so it leads the sheet. */}
            <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {label.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{label}</p>
                {props.userEmail && props.userName ? (
                  <p className="truncate text-xs text-muted-foreground">{props.userEmail}</p>
                ) : null}
                <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-primary uppercase">
                  {props.roleName}
                </span>
              </div>
            </div>

            {sections.map((group) => (
              <section key={group.label} className="mt-5">
                <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {group.label}
                </h2>
                <div className="grid grid-cols-3 gap-2">
                  {group.items.map((item) => (
                    <SheetTile key={item.href} item={item} active={isCurrent(pathname, item.href)} />
                  ))}
                </div>
              </section>
            ))}

            <section className="mt-5">
              <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Appearance
              </h2>
              <ThemeSegments />
            </section>

            <form action={signOut} className="mt-5">
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 text-sm font-semibold text-destructive transition active:scale-[0.99]"
              >
                <LogOutIcon className="size-4" />
                Sign out
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TabIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'grid h-8 w-14 place-items-center rounded-full transition-all duration-200',
        active ? 'bg-primary/12 text-primary' : 'text-muted-foreground group-active:scale-90',
      )}
    >
      {children}
    </span>
  );
}

function TabLabel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'max-w-full truncate px-0.5 text-[11px] leading-none',
        active ? 'font-semibold text-primary' : 'font-medium text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className="group flex min-w-0 flex-1 flex-col items-center justify-center gap-1 outline-none"
    >
      <TabIcon active={active}>
        <Icon className="size-[20px]" strokeWidth={active ? 2.1 : 1.7} />
      </TabIcon>
      <TabLabel active={active}>{item.shortLabel ?? item.label}</TabLabel>
    </Link>
  );
}

function SheetTile({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  if (item.status === 'planned') {
    return (
      <span className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-2 py-3.5 text-center text-muted-foreground/60">
        <Icon className="size-5" strokeWidth={1.6} />
        <span className="text-xs leading-tight font-medium">{item.label}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl border px-2 py-3.5 text-center transition active:scale-[0.97]',
        active
          ? 'border-primary/30 bg-primary/8 text-primary'
          : 'border-border/70 bg-card text-foreground',
      )}
    >
      <span
        className={cn(
          'grid size-9 place-items-center rounded-xl',
          active ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.8} />
      </span>
      <span className="line-clamp-2 text-xs leading-tight font-medium">{item.label}</span>
    </Link>
  );
}

const THEMES = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const;

function subscribeToNothing() {
  return () => {};
}

function ThemeSegments() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-2xl bg-muted/70 p-1">
      {THEMES.map((option) => {
        const active = mounted && (theme ?? 'system') === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              'flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            <option.icon className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

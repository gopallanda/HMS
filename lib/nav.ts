/**
 * Navigation.
 *
 * One table describes every module, who may see it, and whether it exists yet.
 * The sidebar renders it; the login flow reads it to decide where to drop a
 * user after sign-in. Adding a module is an edit here, not a new component.
 *
 * Unbuilt modules may be listed with status `planned` (CLAUDE.md 1): they render
 * greyed out with their phase number instead of being hidden, so staff can see a
 * module is coming and nobody clicks through to a 404. Nothing is planned right
 * now -- IPD (Phase 3) is the next candidate. Lab and pharmacy were removed
 * rather than shown as Phase 2; they go back in here when they are built.
 */

import {
  BuildingIcon,
  Building2Icon,
  CalendarClockIcon,
  ContactRoundIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  ReceiptIndianRupeeIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  UserRoundPlusIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

import { isAdminRole, type AppRole } from '@/lib/roles';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Empty means every signed-in member of the hospital. */
  roles: readonly AppRole[];
  /** 'planned' items are visible but not clickable. */
  status: 'ready' | 'planned';
  phase: 0 | 1 | 2 | 3;
};

export type NavSection = {
  label: string;
  items: readonly NavItem[];
};

const DESK: readonly AppRole[] = ['super_admin', 'admin', 'front_desk'];
const MONEY: readonly AppRole[] = ['super_admin', 'admin', 'cashier'];
const CLINICAL: readonly AppRole[] = ['super_admin', 'admin', 'doctor'];
const ADMIN: readonly AppRole[] = ['super_admin', 'admin'];

export const NAV: readonly NavSection[] = [
  {
    label: 'Today',
    items: [
      {
        href: '/',
        label: 'Overview',
        icon: LayoutDashboardIcon,
        roles: [],
        status: 'ready',
        phase: 0,
      },
    ],
  },
  {
    label: 'Front desk',
    items: [
      {
        href: '/front-desk/register',
        label: 'Register patient',
        icon: UserRoundPlusIcon,
        roles: DESK,
        status: 'ready',
        phase: 1,
      },
      {
        href: '/front-desk/queue',
        label: 'Queue',
        icon: CalendarClockIcon,
        roles: DESK,
        status: 'ready',
        phase: 1,
      },
    ],
  },
  {
    label: 'Billing',
    items: [
      {
        href: '/billing/collect',
        label: 'Collect payment',
        icon: CreditCardIcon,
        roles: MONEY,
        status: 'ready',
        phase: 1,
      },
      {
        href: '/billing/invoices',
        label: 'Invoices',
        icon: ReceiptIcon,
        roles: MONEY,
        status: 'ready',
        phase: 1,
      },
      {
        href: '/billing/day-close',
        label: 'Day close',
        icon: SlidersHorizontalIcon,
        roles: MONEY,
        status: 'ready',
        phase: 1,
      },
    ],
  },
  {
    label: 'Clinical',
    items: [
      {
        href: '/doctor/queue',
        label: 'My queue',
        icon: StethoscopeIcon,
        roles: CLINICAL,
        status: 'ready',
        phase: 1,
      },
    ],
  },
  /**
   * Deliberately AFTER Clinical, and deliberately `roles: []`.
   *
   * Everybody looks a patient up: the cashier chasing a balance, the doctor
   * checking what was written last month, the lab matching a sample to a name.
   * What each of them SEES on the record differs by role -- the money and the
   * clinical panels are gated on the page itself -- but the door is the same
   * one.
   *
   * The position matters beyond tidiness: landingFor() drops a user on the
   * first ready item they can see, so a section carrying an everyone-item
   * placed above Front desk or Billing would quietly move reception and the
   * cashier off the screen they open all day.
   */
  {
    label: 'Records',
    items: [
      {
        href: '/patients',
        label: 'Patients',
        icon: ContactRoundIcon,
        roles: [],
        status: 'ready',
        phase: 1,
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        href: '/admin/settings',
        label: 'Hospital settings',
        icon: BuildingIcon,
        roles: ADMIN,
        status: 'ready',
        phase: 0,
      },
      {
        href: '/admin/departments',
        label: 'Departments',
        icon: Building2Icon,
        roles: ADMIN,
        status: 'ready',
        phase: 0,
      },
      {
        href: '/admin/staff',
        label: 'Staff',
        icon: UsersIcon,
        roles: ADMIN,
        status: 'ready',
        phase: 0,
      },
      {
        href: '/admin/services',
        label: 'Price list',
        icon: ReceiptIndianRupeeIcon,
        roles: ADMIN,
        status: 'ready',
        phase: 1,
      },
    ],
  },
];

function visibleTo(item: NavItem, role: AppRole | null): boolean {
  if (item.roles.length === 0) return true;
  return role !== null && item.roles.includes(role);
}

/** The sections a role may see, with empty sections dropped. */
export function navFor(role: AppRole | null): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => visibleTo(item, role)),
  })).filter((section) => section.items.length > 0);
}

/**
 * Where to send someone after they sign in: their first module that actually
 * exists. Everyone can see the overview, so this always resolves.
 *
 * Administrators are the exception and land on the overview itself. It carries
 * the setup checklist, which is the only useful screen in a hospital that has
 * just been created and has no departments, doctors or patients yet -- and for
 * an established admin the overview is still the right home, because
 * /front-desk/register is a receptionist's screen, not theirs.
 */
export function landingFor(role: AppRole | null): string {
  if (role !== null && isAdminRole(role)) return '/';

  for (const section of navFor(role)) {
    const ready = section.items.find((item) => item.status === 'ready' && item.href !== '/');
    if (ready) return ready.href;
  }
  return '/';
}

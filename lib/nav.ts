/**
 * Navigation.
 *
 * One table describes every module, who may see it, and whether it exists yet.
 * The sidebar renders it; the login flow reads it to decide where to drop a
 * user after sign-in. Adding a module is an edit here, not a new component.
 *
 * Phase 1-3 modules are listed but marked `planned` (CLAUDE.md 1). They render
 * greyed out with their phase number instead of being hidden, so a cashier can
 * see that billing is coming and nobody clicks through to a 404. Delete the
 * `planned` flag when the module lands.
 */

import {
  BuildingIcon,
  Building2Icon,
  CalendarClockIcon,
  CreditCardIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
  PillIcon,
  ReceiptIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  UserRoundPlusIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AppRole } from '@/lib/roles';

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
      {
        href: '/lab/orders',
        label: 'Lab orders',
        icon: FlaskConicalIcon,
        roles: ['super_admin', 'admin', 'lab_tech', 'doctor'],
        status: 'planned',
        phase: 2,
      },
      {
        href: '/pharmacy/dispense',
        label: 'Pharmacy',
        icon: PillIcon,
        roles: ['super_admin', 'admin', 'pharmacist'],
        status: 'planned',
        phase: 2,
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
 */
export function landingFor(role: AppRole | null): string {
  for (const section of navFor(role)) {
    const ready = section.items.find((item) => item.status === 'ready' && item.href !== '/');
    if (ready) return ready.href;
  }
  return '/';
}

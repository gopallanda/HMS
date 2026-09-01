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
  CalendarRangeIcon,
  ChartNoAxesColumnIcon,
  ContactRoundIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  ReceiptIndianRupeeIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  UserRoundPlusIcon,
  UsersIcon,
  WalletCardsIcon,
  type LucideIcon,
} from 'lucide-react';

import type { Permission, PermissionSet } from '@/lib/rbac/permissions';
import { roleHome } from '@/lib/rbac/routes';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * What the viewer must hold to see this row. ANY one of them is enough --
   * the billing section is one link per screen and a cashier who may collect
   * but not report should still see the section.
   *
   * Empty means every signed-in member of the hospital.
   *
   * These are the SAME keys ROUTE_PERMISSIONS guards the route with, and they
   * have to stay that way: a row the nav shows and the proxy bounces is worse
   * than no row at all. Where a screen needs a narrower permission than its
   * section, the narrow one goes here.
   */
  permissions: readonly Permission[];
  /** 'planned' items are visible but not clickable. */
  status: 'ready' | 'planned';
  phase: 0 | 1 | 2 | 3;
};

export type NavSection = {
  label: string;
  items: readonly NavItem[];
};


export const NAV: readonly NavSection[] = [
  {
    label: 'Today',
    items: [
      {
        href: '/',
        label: 'Overview',
        icon: LayoutDashboardIcon,
        /**
         * The hospital dashboard, and NOT a screen for everybody.
         *
         * It carries the setup checklist, the day's takings and the tenant's
         * lifecycle banner -- a manager's view of the business, which is why
         * reports.view is the right key for it. A doctor holding no
         * reports.view neither sees this row nor reaches `/`: the proxy sends
         * them to their queue instead. That is the whole of defect 1.
         */
        permissions: ['reports.view'],
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
        permissions: ['visits.create'],
        status: 'ready',
        phase: 1,
      },
      {
        href: '/front-desk/queue',
        label: 'Queue',
        icon: CalendarClockIcon,
        permissions: ['queue.read'],
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
        permissions: ['billing.collect'],
        status: 'ready',
        phase: 1,
      },
      {
        href: '/billing/invoices',
        label: 'Invoices',
        icon: ReceiptIcon,
        permissions: ['billing.read'],
        status: 'ready',
        phase: 1,
      },
      {
        href: '/billing/dues',
        label: 'Outstanding dues',
        icon: WalletCardsIcon,
        permissions: ['billing.read'],
        status: 'ready',
        phase: 1,
      },
      {
        href: '/billing/day-close',
        label: 'Day close',
        icon: SlidersHorizontalIcon,
        permissions: ['reports.view'],
        status: 'ready',
        phase: 1,
      },
      /**
       * The reports index (item 9).
       *
       * ROUTE_PERMISSIONS guarded /reports from block 3 and there was no
       * directory behind it. It is a door now, and it belongs in the nav for
       * the same reason it belongs in the route map: an owner looking for
       * "the reports" should not have to know they live under Billing.
       */
      {
        href: '/reports',
        label: 'Reports',
        icon: ChartNoAxesColumnIcon,
        permissions: ['reports.view'],
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
        permissions: ['consultation.read'],
        status: 'ready',
        phase: 1,
      },
    ],
  },
  /**
   * Deliberately AFTER Clinical.
   *
   * Almost everybody looks a patient up: the cashier chasing a balance, the
   * doctor checking what was written last month, the lab matching a sample to
   * a name. What each of them SEES on the record differs -- the money and the
   * clinical panels are gated on the page itself -- but the door is the same
   * one, and patients.read is what opens it.
   *
   * The position matters beyond tidiness: roleHome() falls through this list
   * for a role it does not recognise, so a broadly-held screen placed above
   * Front desk or Billing would quietly move a custom receptionist role off
   * the screen they open all day.
   */
  {
    label: 'Records',
    items: [
      {
        href: '/patients',
        label: 'Patients',
        icon: ContactRoundIcon,
        permissions: ['patients.read'],
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
        permissions: ['settings.manage'],
        status: 'ready',
        phase: 0,
      },
      {
        href: '/admin/departments',
        label: 'Departments',
        icon: Building2Icon,
        permissions: ['departments.manage'],
        status: 'ready',
        phase: 0,
      },
      {
        href: '/admin/staff',
        label: 'Staff',
        icon: UsersIcon,
        permissions: ['staff.read'],
        status: 'ready',
        phase: 0,
      },
      /**
       * Roles and the roster, from the phase 1 remediation.
       *
       * roster.read rather than settings.manage is the point of the whole
       * section being permission-keyed: a Manager holds the roster and the
       * staff list and holds neither the settings nor the roles, and until
       * block 3 this table could not express that.
       */
      {
        href: '/admin/roles',
        label: 'Roles',
        icon: ShieldIcon,
        permissions: ['roles.manage'],
        status: 'ready',
        phase: 1,
      },
      {
        href: '/admin/roster',
        label: 'Roster',
        icon: CalendarRangeIcon,
        permissions: ['roster.read'],
        status: 'ready',
        phase: 1,
      },
      {
        href: '/admin/services',
        label: 'Price list',
        icon: ReceiptIndianRupeeIcon,
        permissions: ['settings.manage'],
        status: 'ready',
        phase: 1,
      },
    ],
  },
];

function visibleTo(item: NavItem, held: PermissionSet): boolean {
  if (item.permissions.length === 0) return true;
  return item.permissions.some((permission) => held.has(permission));
}

/**
 * The sections this permission set may see, with empty sections dropped.
 *
 * Filtering here is COSMETIC and nothing else (CLAUDE.md 3.6). It stops a
 * nurse being shown "Add staff"; what stops her using it is
 * requirePermission() in the action and the RLS policy under that. A nav
 * filter is a courtesy to the person, not a control on them.
 */
export function navFor(held: PermissionSet): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => visibleTo(item, held)),
  })).filter((section) => section.items.length > 0);
}

/** Every ready destination, in nav order. What roleHome() falls through. */
export function navLandings(held: PermissionSet): string[] {
  return navFor(held)
    .flatMap((section) => section.items)
    .filter((item) => item.status === 'ready')
    .map((item) => item.href);
}

/**
 * Where to send someone after they sign in.
 *
 * The role's own home when their permissions allow it, then the first screen
 * in their own nav, then the overview. `/` is last on purpose: it is the
 * hospital dashboard, and dropping a doctor there was defect 1.
 */
export function landingFor(roleCode: string | null, held: PermissionSet): string {
  return roleHome(roleCode, held, navLandings(held));
}

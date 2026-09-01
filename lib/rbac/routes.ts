/**
 * Where a route guard looks, and where a person lands.
 *
 * TWO DELIBERATE DEVIATIONS from the reference auth spec, both recorded in
 * CLAUDE.md 3.6:
 *
 *   1. GUARD ON PERMISSIONS, NOT ON ROLE NAMES. The spec isolates four portals
 *      by role string. This product lets an administrator invent roles at
 *      /admin/roles without a deploy, so a hardcoded switch on role names
 *      would lock every custom role out of every screen the day it is created.
 *      ROUTE_PERMISSIONS below is keyed on permissions; the role code is used
 *      for exactly one thing, picking a landing page, and even that falls back
 *      to permissions when the code is unknown.
 *
 *   2. ONE SHELL, NOT FOUR PORTALS. Everybody gets the same layout with the
 *      nav filtered by permission. Four app trees would triple the surface for
 *      three developers, and the isolation would be cosmetic anyway -- it
 *      comes from the guard, not from the URL prefix.
 *
 * This module is imported by the proxy (edge runtime), so it must stay free of
 * server-only imports and of anything that pulls in the generated types.
 */

import type { Permission, PermissionSet } from './permissions';

/**
 * Where each SYSTEM role starts its day. Keyed by roles.code, not by app_role.
 *
 * A custom role is not here and does not need to be: roleHome() falls through
 * to the first navigable screen the role's permissions allow, which for a
 * "Ward sister" with queue and consultation reads is the doctor queue, and for
 * a "Billing supervisor" is the invoice list. Adding a row here is an
 * optimisation over that guess, never a requirement.
 *
 * pharmacist and lab_technician point at /patients on purpose. Their own
 * modules are Phase 2 and the routes do not exist yet; sending them to a 404
 * on their first sign-in would be worse than sending them to the one screen
 * they can genuinely use. Change these two lines when those modules land.
 */
export const ROLE_HOME: Record<string, string> = {
  admin: '/',
  manager: '/',
  doctor: '/doctor/queue',
  nurse: '/doctor/queue',
  front_desk: '/front-desk/register',
  cashier: '/billing/collect',
  accountant: '/billing/invoices',
  pharmacist: '/patients',
  lab_technician: '/patients',
};

/**
 * The route guard. Longest matching prefix wins, so the specific entries above
 * a section can narrow it -- /billing/day-close needs reports.view even though
 * the rest of /billing only needs billing.read.
 *
 * A path that matches NOTHING here is open to any signed-in member of the
 * hospital. That is the right default for /, /change-password and the like,
 * and it is why every screen carrying data also carries an entry.
 */
export const ROUTE_PERMISSIONS: readonly (readonly [string, Permission])[] = [
  // Administration. The app's tree is /admin/*, not the /settings/* the
  // prompt sketched -- see PROGRESS.md, block 1.
  ['/admin/roles', 'roles.manage'],
  ['/admin/roster', 'roster.read'],
  ['/admin/departments', 'departments.manage'],
  ['/admin/staff', 'staff.read'],
  ['/admin/services', 'settings.manage'],
  ['/admin/settings', 'settings.manage'],
  ['/admin', 'settings.manage'],

  // Front desk.
  ['/front-desk/register', 'visits.create'],
  ['/front-desk/queue', 'queue.read'],
  ['/front-desk/incomplete', 'queue.read'],
  ['/front-desk', 'visits.create'],

  // Billing. day-close is a report, and an accountant who may not collect
  // still has to be able to close the day.
  ['/billing/day-close', 'reports.view'],
  ['/billing/collect', 'billing.collect'],
  // Who owes us money. billing.read rather than reports.view: a cashier
  // chasing a balance at the counter is the person this screen is for.
  ['/billing/dues', 'billing.read'],
  ['/billing/invoices', 'billing.read'],
  ['/billing', 'billing.read'],

  // Clinical. consultation.read rather than .write, so a nurse recording
  // vitals reaches the queue; writing a note is refused a layer down.
  ['/doctor', 'consultation.read'],

  ['/patients', 'patients.read'],

  // Printing. A receipt is a billing document even when reception prints it,
  // and front desk holds billing.read for exactly this.
  ['/print', 'billing.read'],

  ['/reports', 'reports.view'],
];

/**
 * The permission a path needs, or null when it needs none beyond a session.
 * Longest prefix wins.
 */
export function requiredPermission(pathname: string): Permission | null {
  let best: Permission | null = null;
  let bestLength = -1;

  for (const [prefix, permission] of ROUTE_PERMISSIONS) {
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && prefix.length > bestLength) {
      best = permission;
      bestLength = prefix.length;
    }
  }

  return best;
}

export function mayOpen(pathname: string, held: PermissionSet): boolean {
  const needed = requiredPermission(pathname);
  return needed === null || held.has(needed);
}

/**
 * Where to send this person now.
 *
 * The role's own home if their permissions actually allow it -- an
 * administrator who has been narrowed to a Manager keeps working rather than
 * bouncing off /admin -- then the first screen in `candidates` they may open,
 * then the overview, which needs nothing.
 *
 * `candidates` is passed in rather than imported so this module stays free of
 * lib/nav.ts and its lucide icons, which the edge bundle should not carry.
 */
export function roleHome(
  roleCode: string | null,
  held: PermissionSet,
  candidates: readonly string[] = DEFAULT_LANDINGS,
): string {
  const preferred = roleCode ? ROLE_HOME[roleCode] : undefined;
  if (preferred && mayOpen(preferred, held)) return preferred;

  for (const href of candidates) {
    if (mayOpen(href, held)) return href;
  }

  return '/';
}

/**
 * The order a landing page is guessed in for a role with no row in ROLE_HOME.
 *
 * Ordered by how much of somebody's day the screen occupies, not
 * alphabetically: whoever holds visits.create sits at reception all day, and
 * whoever holds only patients.read is looking something up.
 */
const DEFAULT_LANDINGS: readonly string[] = [
  '/front-desk/register',
  '/doctor/queue',
  '/billing/collect',
  '/billing/invoices',
  '/admin/roster',
  '/patients',
  '/',
];

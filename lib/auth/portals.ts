/**
 * The three sign-in doors: Admin, Doctor, Staff.
 *
 * PRESENTATION, NOT A CONTROL. What somebody may open is still decided by
 * their permissions once they are in (CLAUDE.md 3.6) -- all three doors lead
 * into the same shell. The doors exist because a clerk at the counter wants
 * the screen that is "theirs", and because a doctor typing into the staff
 * form is usually somebody on the wrong machine.
 *
 * The one thing a door DOES enforce is that it is the right one: after the
 * password checks out, the action works out which door this account belongs
 * to and, if it is a different one, signs the session straight back out and
 * says where to go instead. Only somebody who already knows the password ever
 * sees that sentence, so it gives away nothing about which accounts exist.
 *
 * Shared by client and server, so no server-only imports here.
 */

import { z } from 'zod';

export const PORTALS = ['admin', 'doctor', 'staff'] as const;

export type Portal = (typeof PORTALS)[number];

export const portalSchema = z.enum(PORTALS).catch('admin');

export type PortalConfig = {
  href: string;
  /** Short, for the links under the card: "Doctor login". */
  label: string;
  /** The pill at the top of the card. */
  badge: string;
  title: string;
  subtitle: string;
  /** Whether the founder's email switch is offered. Admin only. */
  allowsEmail: boolean;
};

export const PORTAL_CONFIG: Record<Portal, PortalConfig> = {
  admin: {
    href: '/login',
    label: 'Admin login',
    badge: 'Admin portal',
    title: 'Welcome back',
    subtitle: 'Sign in to manage the hospital, departments, staff and rosters.',
    allowsEmail: true,
  },
  doctor: {
    href: '/login/doctor',
    label: 'Doctor login',
    badge: 'Doctor portal',
    title: 'Good to see you, Doctor',
    subtitle: 'Sign in to see your queue and write consultations.',
    allowsEmail: false,
  },
  staff: {
    href: '/login/staff',
    label: 'Staff login',
    badge: 'Staff portal',
    title: 'Start your shift',
    subtitle: 'Front desk, billing, nursing and everyone else signs in here.',
    allowsEmail: false,
  },
};

/** Role codes (public.roles.code) that belong on the admin door. */
const ADMIN_ROLE_CODES = new Set(['admin', 'manager']);

/**
 * Which doors this account may use.
 *
 * Usually one. The exception is the owner who is also one of the doctors: her
 * membership is super_admin and her staff role is Doctor, and both doors are
 * honestly hers. Anybody who is neither admin nor doctor -- every custom role
 * included -- belongs on the staff door, which is why that one is the
 * fallthrough rather than a list.
 */
export function portalsFor(roleCode: string | null, membershipRole: string | null): Set<Portal> {
  const portals = new Set<Portal>();

  if (
    membershipRole === 'super_admin' ||
    membershipRole === 'admin' ||
    (roleCode !== null && ADMIN_ROLE_CODES.has(roleCode))
  ) {
    portals.add('admin');
  }
  if (roleCode === 'doctor' || membershipRole === 'doctor') {
    portals.add('doctor');
  }
  if (portals.size === 0) portals.add('staff');

  return portals;
}

/** The sentence a wrong door says, and where it points. */
export function wrongPortalMessage(tried: Portal, belongs: Portal): string {
  const here = PORTAL_CONFIG[tried].badge.toLowerCase();
  const kind: Record<Portal, string> = {
    admin: 'an administrator account',
    doctor: 'a doctor account',
    staff: 'a staff account',
  };
  return `This is the ${here}. Yours is ${kind[belongs]}. Use ${PORTAL_CONFIG[belongs].label}.`;
}

/**
 * Turning one my_access() row into what the caller may do.
 *
 * Pure on purpose, and with no `server-only` import: this runs in TWO
 * runtimes. The proxy (edge) needs it to guard a route before any page
 * renders, and lib/rbac/access.ts needs it on the Node server to build the
 * session. Two copies of this mapping would eventually disagree, and the
 * disagreement would read as "the menu shows it but the page says no".
 */

import { PERMISSIONS, toPermissionSet, type Permission, type PermissionSet } from './permissions';

/** Exactly the shape public.my_access() returns. Duplicated here rather than
 *  imported from types/database.ts so this module has no dependency on the
 *  generated types, which the edge bundle would otherwise pull in whole. */
export type MyAccess = {
  staff_id: string;
  staff_name: string;
  role_id: string;
  role_code: string;
  role_name: string;
  role_can_login: boolean;
  staff_can_login: boolean | null;
  permissions: string[];
  has_account: boolean;
  account_disabled: boolean;
  must_change_password: boolean;
  username: string | null;
  contact_email: string | null;
};

export type AccessContext = {
  staffId: string | null;
  staffName: string | null;
  roleId: string | null;
  /** The role's code -- 'doctor', 'front_desk', a custom one. Not app_role. */
  roleCode: string | null;
  roleName: string | null;
  permissions: PermissionSet;
  /** Whether this person's role uses the software at all. */
  canLogin: boolean;
  /** They have a staff_accounts row (they were provisioned, not invited). */
  hasAccount: boolean;
  accountDisabled: boolean;
  mustChangePassword: boolean;
  username: string | null;
  contactEmail: string | null;
};

const EMPTY: PermissionSet = new Set<Permission>();

/**
 * The fallback for a login with NO staff record in the active hospital.
 *
 * Not a hypothetical: a founder provisioned before staff records existed has a
 * membership and a hospital and nothing else. An administrator falls back to
 * every permission -- which grants them nothing they did not already hold,
 * since is_hospital_admin() already opens every write policy in the database
 * -- and everyone else falls back to none, which sends them to /access-denied
 * with something to show an administrator.
 */
export function fallbackAccess(membershipRole: string | null): AccessContext {
  const admin = membershipRole === 'super_admin' || membershipRole === 'admin';
  return {
    staffId: null,
    staffName: null,
    roleId: null,
    roleCode: admin ? 'admin' : null,
    roleName: null,
    permissions: admin ? toPermissionSet(PERMISSIONS) : EMPTY,
    canLogin: true,
    hasAccount: false,
    accountDisabled: false,
    mustChangePassword: false,
    username: null,
    contactEmail: null,
  };
}

export function resolveAccess(
  row: MyAccess | null,
  membershipRole: string | null,
): AccessContext {
  if (!row) return fallbackAccess(membershipRole);

  return {
    staffId: row.staff_id,
    staffName: row.staff_name,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    /**
     * super_admin is the one membership role that overrides the staff role.
     *
     * It is a PLATFORM role: provision_hospital never mints one, the role
     * editor cannot grant one, and no hospital administrator can hand it out.
     * Whoever holds it can already do anything in this tenant, because
     * is_hospital_admin() opens every write policy in the database -- so
     * withholding a permission from them in the app would be a UI-only
     * restriction over somebody who can do it anyway, which is a lie rather
     * than a control.
     *
     * It also matters concretely: the hospital's owner is usually one of the
     * doctors. Her staff role is Doctor, because that is her job, and without
     * this she would be locked out of her own settings by the software she
     * bought.
     *
     * `admin` is deliberately NOT here. A hospital's Manager role carries the
     * legacy value 'admin' so that RLS lets it write staff and departments,
     * and widening this to 'admin' would hand every manager settings.manage
     * and roles.manage -- the two things the Manager role exists to exclude.
     */
    permissions:
      membershipRole === 'super_admin'
        ? toPermissionSet(PERMISSIONS)
        : toPermissionSet(row.permissions ?? []),
    // The role decides, and a staff record may only narrow it. `true` is never
    // stored on staff.can_login, so this can only ever take login away.
    canLogin: row.role_can_login && (row.staff_can_login ?? true),
    hasAccount: row.has_account,
    accountDisabled: row.account_disabled,
    mustChangePassword: row.must_change_password,
    username: row.username,
    contactEmail: row.contact_email,
  };
}

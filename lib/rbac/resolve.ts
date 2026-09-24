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
 * SAME RULE AS resolveAccess BELOW, and that is the whole point of this
 * version: super_admin falls back to every permission, `admin` does not.
 *
 * It used to include `admin`, justified by the founder who was provisioned
 * before staff records existed. That justification is gone --
 * provision_hospital has seeded the founder a staff row carrying the admin
 * role since 20260828090100, and staff.role_id is NOT NULL with a backfill
 * that fails the migration rather than ship a row without one, so a founder
 * resolves through my_access() like everybody else and never reaches here.
 *
 * What it left behind was a contradiction with its own sibling. The seeded
 * MANAGER role carries legacy_role 'admin' so that RLS lets it write staff and
 * departments -- which is exactly why resolveAccess refuses to treat `admin`
 * as an override, in a comment that spells out that widening it "would hand
 * every manager settings.manage and roles.manage -- the two things the Manager
 * role exists to exclude". Granting them here, one screen up, on any request
 * where my_access() happens to come back null, is the same widening arrived at
 * by accident.
 *
 * So both functions now answer it the same way, and `admin` with no staff
 * record gets nothing: /access-denied with something to show an administrator,
 * which is the fail-closed answer. A tenant that genuinely strands its only
 * administrator in that state is repaired the way it always was -- a
 * service-role write, or scripts/backfill-founder-accounts.mjs -- and NOT by
 * the app quietly handing out settings.manage to whoever turns up without a
 * staff row.
 */
export function fallbackAccess(membershipRole: string | null): AccessContext {
  const platformAdmin = membershipRole === 'super_admin';
  return {
    staffId: null,
    staffName: null,
    roleId: null,
    roleCode: platformAdmin ? 'admin' : null,
    roleName: null,
    permissions: platformAdmin ? toPermissionSet(PERMISSIONS) : EMPTY,
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

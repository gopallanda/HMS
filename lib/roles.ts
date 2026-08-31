/**
 * The membership role on the JWT.
 *
 * NOT what decides who may do what. That is the staff ROLE and its permission
 * set (lib/rbac/permissions.ts, lib/rbac/access.ts): admins invent roles at
 * /admin/roles without a deploy, so anything branching on the strings below
 * locks every custom role out of everything (CLAUDE.md 3.6).
 *
 * What survives here is what app_role is genuinely for:
 *
 *   * a LABEL, for a login with no staff record -- a founder, in practice
 *   * `isAdminRole`, for the tenant-lifecycle banner, which is a fact about
 *     the subscription rather than about the hospital's own permissions
 *
 * The role sets this file used to carry -- FRONT_DESK_ROLES, BILLING_ROLES,
 * CLINICAL_ROLES, ADMIN_ROLES -- went in block 7. Each of them had a twin
 * assert_*() in Postgres, and the pair had to be kept in step by hand;
 * checkPermission() and the permission set replaced both.
 *
 * AppRole is re-exported from the generated database types on purpose: when
 * types/database.ts is regenerated (CLAUDE.md 9 step 4) a role added in SQL
 * but forgotten here becomes a type error in ROLE_LABEL below.
 */

import type { Database } from '@/types/database';

export type AppRole = Database['public']['Enums']['app_role'];

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  doctor: 'Doctor',
  front_desk: 'Front desk',
  cashier: 'Cashier',
  pharmacist: 'Pharmacist',
  lab_tech: 'Lab technician',
  nurse: 'Nurse',
};

export function roleLabel(role: AppRole | null | undefined): string {
  return role ? ROLE_LABEL[role] : 'No role';
}

/**
 * Whether this login owns the tenant's subscription, for the lifecycle banner.
 *
 * Deliberately still app_role and not `settings.manage`: a suspended or expired
 * hospital is a billing matter between the vendor and whoever signed up, and it
 * is that person's token that carries the admin claim. A Manager holding
 * settings.manage inside the hospital has nothing to do with it and should not
 * be shown a "renew your subscription" banner they cannot act on.
 *
 * Keep in sync with public.is_hospital_admin().
 */
export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin';
}

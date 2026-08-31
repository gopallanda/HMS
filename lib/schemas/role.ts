/**
 * Roles.
 *
 * A role is what somebody DOES, and therefore what they may open. It is not a
 * department -- a nurse in Cardiology and a nurse in Housekeeping hold the same
 * role -- and permissions are never derived from one.
 *
 * The permission KEYS are a frozen union in lib/rbac/permissions.ts. This
 * schema only checks that the keys posted by a form are ones the code knows
 * about, which is what stops a hand-crafted POST from writing
 * `billing.everything` into role_permissions and leaving an administrator
 * believing they granted something.
 */

import { z } from 'zod';

import { clientId, optionalText, text } from '@/lib/schemas/form';
import { isPermission, PERMISSIONS, type Permission } from '@/lib/rbac/permissions';

/**
 * The code is the stable handle: seed_system_roles finds system roles by it,
 * and the landing map in block 3 will too. Lowercase, ascii, snake_case, and
 * matched by the CHECK constraint on public.roles.code.
 */
export const roleCode = z
  .string({ error: 'A code is required.' })
  .trim()
  .toLowerCase()
  .min(2, 'The code must be at least 2 characters.')
  .max(39, 'The code must be 39 characters or fewer.')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Use lowercase letters, digits and underscores, starting with a letter.',
  );

export const permissionKey = z.string().refine(isPermission, {
  error: 'That is not a permission this version of the software enforces.',
});

/**
 * FormData carries repeated checkbox values as repeated entries, so the action
 * hands this a string[] from getAll(). An empty array is legitimate and means
 * exactly what it says: the cleaner's role holds nothing.
 */
export const permissionList = z
  .array(permissionKey)
  .max(PERMISSIONS.length, 'That is more permissions than exist.')
  .transform((keys) => Array.from(new Set(keys)) as Permission[]);

export const roleSchema = z.object({
  id: clientId,
  code: roleCode,
  name: text('Name', 2, 60),
  description: optionalText('Description', 200),
  /**
   * A role that does not use the software. The staff form hides the whole
   * credentials section for it, and the provisioning action refuses it -- the
   * check is repeated there because that action is reachable by POST.
   */
  can_login: z
    .union([z.boolean(), z.string(), z.undefined(), z.null()])
    .transform((value) => value === true || value === 'on' || value === 'true'),
  permissions: permissionList,
});

export type RoleInput = z.infer<typeof roleSchema>;

/**
 * Editing a system role.
 *
 * Its code is fixed -- seed_system_roles and the landing map both refer to it
 * -- but its name, description and permissions are the hospital's business. A
 * hospital that calls its receptionists "OPD desk" should be able to say so.
 */
export const systemRoleSchema = roleSchema.omit({ code: true });

export type SystemRoleInput = z.infer<typeof systemRoleSchema>;

export const roleDeleteSchema = z.object({
  id: z.uuid('Invalid role.'),
  confirm: z.string().trim(),
});

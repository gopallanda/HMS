import 'server-only';

import { cache } from 'react';

import { resolveAccess, type AccessContext, type MyAccess } from '@/lib/rbac/resolve';
import type { Permission } from '@/lib/rbac/permissions';
import type { AppRole } from '@/lib/roles';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What the caller may do, resolved from their ROLE rather than from their
 * membership enum.
 *
 * The mapping itself lives in lib/rbac/resolve.ts, because the proxy needs the
 * same answer one runtime earlier to guard a route before any page renders.
 * This module is only the server-side fetch around it.
 *
 * Permission keys that no longer name a real permission are dropped on the way
 * in. A key retired from the union stops having an effect without a data
 * migration.
 */

export type { AccessContext } from '@/lib/rbac/resolve';

type Client = SupabaseClient<Database>;

export async function loadAccess(
  supabase: Client,
  membershipRole: AppRole | null,
): Promise<AccessContext> {
  const { data, error } = await supabase.rpc('my_access');

  // An error is treated exactly like "no staff record": fail to the fallback,
  // which is every permission for an administrator and none for anybody else.
  return resolveAccess(error ? null : ((data ?? null) as MyAccess | null), membershipRole);
}

/** Per-request memo, so a layout, its page and an action share one lookup. */
export const cachedLoadAccess = cache(loadAccess);

export function hasPermission(access: AccessContext, permission: Permission): boolean {
  return access.permissions.has(permission);
}

export function hasAnyPermission(
  access: AccessContext,
  ...permissions: Permission[]
): boolean {
  return permissions.some((permission) => access.permissions.has(permission));
}

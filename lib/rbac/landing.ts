import 'server-only';

import { loadAccess } from '@/lib/rbac/access';
import { landingFor } from '@/lib/nav';
import type { AppRole } from '@/lib/roles';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Where to drop the caller, resolved from their ROLE and permissions.
 *
 * Two flows end by sending somebody into the app -- signing in, and finishing
 * a forced password change -- and both used to guess from the membership enum,
 * which is how a doctor ended up on the hospital dashboard (defect 1). Both
 * now ask this, and this asks my_access().
 *
 * The proxy would correct a wrong guess on the next request anyway (it sends
 * anybody landing on `/` to their own home), but a redirect that lands right
 * the first time is one fewer round trip on the slowest screen in the product.
 */
export async function landingForCaller(
  supabase: SupabaseClient<Database>,
  membershipRole: AppRole | null,
): Promise<string> {
  const access = await loadAccess(supabase, membershipRole);
  return landingFor(access.roleCode, access.permissions);
}

import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env, serviceRoleKey } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * ============================================================================
 * SERVICE ROLE CLIENT — BYPASSES ROW LEVEL SECURITY. SERVER ONLY.
 * ============================================================================
 *
 * This client is not scoped to a hospital. It can read and write every row of
 * every tenant. There is no RLS safety net behind it.
 *
 * The `server-only` import above makes importing this from a Client Component
 * a build error, not a runtime surprise.
 *
 * Legitimate uses (CLAUDE.md 5):
 *   - provisioning a new hospital and its first admin
 *   - the auth callback that reads memberships before a JWT claim exists
 *   - background jobs with no user session
 *
 * NOT for:
 *   - anything reachable from a user request that already has a session —
 *     use lib/supabase/server.ts so RLS applies
 *   - "the query is failing, let me just use admin" — that is a policy bug
 *
 * Every call site must filter by hospital_id explicitly. Nothing else will.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey(),
    {
      auth: {
        // No cookies, no session, no token refresh: this client is never a user.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

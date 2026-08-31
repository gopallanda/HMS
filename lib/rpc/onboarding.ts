/**
 * Typed wrapper around provision_hospital().
 *
 * Like the other wrappers here it takes the client rather than making one, so
 * the same function serves the signup action and the provision-on-first-login
 * fallback in the login action (CLAUDE.md 6).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

export type ProvisionResult = {
  /**
   * The hospital the caller now belongs to, or null when there was nothing to
   * provision -- see the RPC comment: null means "signed in, no membership, no
   * pending signup", which the caller must diagnose rather than retry.
   */
  data: string | null;
  error: PostgrestError | null;
};

/**
 * Creates the hospital, the admin membership and the founder's staff row, in
 * one transaction. Idempotent: a caller who already belongs to a hospital gets
 * that hospital back rather than a second one.
 *
 * The cast exists because types/database.ts has not been regenerated since the
 * migration that adds this function -- the hosted project is not reachable from
 * a network without IPv6, so `npm run db:types` cannot see it yet. Callers are
 * still fully typed; the hole is confined to this one line. Remove the cast
 * after `npm run db:push && npm run db:types` (CLAUDE.md 9 step 4).
 */
export async function provisionHospital(supabase: Client): Promise<ProvisionResult> {
  // Cast the client, not the method: `rpc` reads `this.rest` internally, so
  // pulling it into a local strips its receiver and it throws on `undefined`.
  const client = supabase as unknown as {
    rpc: (fn: 'provision_hospital') => Promise<ProvisionResult>;
  };

  return client.rpc('provision_hospital');
}

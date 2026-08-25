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
  const rpc = supabase.rpc as unknown as (
    fn: 'provision_hospital',
  ) => Promise<ProvisionResult>;

  return rpc('provision_hospital');
}

export type AttachStaffLoginResult =
  | { status: 'attached'; user_id: string }
  | { status: 'no_such_user' };

/**
 * Links an auth user to a staff record and gives them a membership.
 *
 * Returns status 'no_such_user' when that email has no account yet -- not an
 * error, but the signal to send an invitation and call this again.
 *
 * Same cast, same reason, same removal instructions as provisionHospital above.
 */
export type AttachStaffLoginArgs = {
  p_staff_id: string;
  p_email: string;
  p_role: Database['public']['Enums']['app_role'];
};

export async function attachStaffLogin(
  supabase: Client,
  args: AttachStaffLoginArgs,
): Promise<{ data: AttachStaffLoginResult | null; error: PostgrestError | null }> {
  const rpc = supabase.rpc as unknown as (
    fn: 'attach_staff_login',
    args: AttachStaffLoginArgs,
  ) => Promise<{ data: AttachStaffLoginResult | null; error: PostgrestError | null }>;

  return rpc('attach_staff_login', args);
}

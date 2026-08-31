import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Resolving a username to a login, and throttling the guesses.
 *
 * WHY THE SERVICE ROLE IS RIGHT HERE, of all places: there is no session yet.
 * A person typing their username is anonymous by definition, and anon holds no
 * grant on staff_accounts -- correctly, since that table is the map of who
 * works where. This module is the one narrow path across that gap, and it
 * returns nothing to the caller that the caller did not already type.
 *
 * Every failure the sign-in action reports is the SAME sentence. Telling a
 * wrong username apart from a wrong password confirms which usernames exist,
 * and in a hospital that is a staff list.
 */

/** Five failures inside fifteen minutes, then fifteen minutes of cooldown. */
export const MAX_FAILED_SIGN_INS = 5;
export const FAILURE_WINDOW_MINUTES = 15;
export const COOLDOWN_MINUTES = 15;

export type ResolvedAccount = {
  id: string;
  hospitalId: string;
  username: string;
  loginEmail: string;
  disabledAt: string | null;
  lockedUntil: string | null;
  mustChangePassword: boolean;
};

/**
 * The account behind a username, or null.
 *
 * Usernames are allocated so they are free across the whole deployment (see
 * lib/accounts/provision.ts), so a bare username resolves to at most one
 * account. `.limit(1)` rather than `.single()` all the same: if historic data
 * ever produced two, signing the first one in is a better failure than
 * throwing, and the allocation is what stops it happening again.
 */
export async function resolveUsername(username: string): Promise<ResolvedAccount | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('staff_accounts')
    .select('id, hospital_id, username, login_email, disabled_at, locked_until, must_change_password')
    .eq('username', username)
    .order('created_at')
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  return {
    id: row.id,
    hospitalId: row.hospital_id,
    username: row.username,
    loginEmail: row.login_email,
    disabledAt: row.disabled_at,
    lockedUntil: row.locked_until,
    mustChangePassword: row.must_change_password,
  };
}

export function isLockedOut(account: ResolvedAccount, now: Date = new Date()): boolean {
  return account.lockedUntil !== null && new Date(account.lockedUntil) > now;
}

/**
 * Count a failed attempt, and lock the account when there have been too many.
 *
 * The window slides forward rather than accumulating for ever: five wrong
 * guesses spread over a fortnight is somebody who mistypes, not somebody
 * attacking, and treating the two the same would lock the hospital's
 * receptionist out on a Monday morning for reasons nobody can reconstruct.
 */
export async function recordFailedSignIn(accountId: string): Promise<void> {
  const admin = createAdminClient();
  const now = new Date();

  const { data: account } = await admin
    .from('staff_accounts')
    .select('failed_sign_ins, first_failed_at')
    .eq('id', accountId)
    .maybeSingle();

  if (!account) return;

  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MINUTES * 60_000);
  const withinWindow =
    account.first_failed_at !== null && new Date(account.first_failed_at) > windowStart;

  const failures = withinWindow ? account.failed_sign_ins + 1 : 1;

  await admin
    .from('staff_accounts')
    .update({
      failed_sign_ins: failures,
      first_failed_at: withinWindow ? account.first_failed_at : now.toISOString(),
      locked_until:
        failures >= MAX_FAILED_SIGN_INS
          ? new Date(now.getTime() + COOLDOWN_MINUTES * 60_000).toISOString()
          : null,
    })
    .eq('id', accountId);
}

/** Clears the counters and stamps the sign-in. */
export async function recordSuccessfulSignIn(accountId: string): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from('staff_accounts')
    .update({
      failed_sign_ins: 0,
      first_failed_at: null,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', accountId);
}

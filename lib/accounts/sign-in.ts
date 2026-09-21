import 'server-only';

import { reportError } from '@/lib/report-error';
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

/**
 * The account behind a sign-in ADDRESS, or null.
 *
 * The login form accepts an email as well as a username, for whoever created
 * the hospital through /signup with their own mailbox. That branch used to sign
 * in through Supabase Auth alone and never look at staff_accounts, which meant
 * the lockout counter and disabled_at did not apply to it -- the one address an
 * attacker is most likely to be able to guess was the one with no throttle on
 * it. This is what closes that: the email branch resolves an account the same
 * way the username branch does, and applies the same two checks.
 *
 * `.eq` on a lowercased address rather than `.ilike`. The unique index is on
 * lower(login_email) and both writers store lowercase, so equality finds the
 * row; ilike would treat an underscore as a wildcard, and `john_doe@gmail.com`
 * matching `johnxdoe@gmail.com` is a way to resolve somebody else's account.
 */
export async function resolveLoginEmail(loginEmail: string): Promise<ResolvedAccount | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('staff_accounts')
    .select('id, hospital_id, username, login_email, disabled_at, locked_until, must_change_password')
    .eq('login_email', loginEmail.trim().toLowerCase())
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
 * ONE ROUND TRIP, and the arithmetic happens in the database under a row lock.
 * This used to read the counter, add one in JavaScript and write the result
 * back -- which counts correctly only if the guesses arrive one at a time.
 * Fifty parallel guesses each read the same zero, each computed one, and each
 * wrote one, so locked_until was never set and the ceiling below was a number
 * in a comment rather than a control.
 *
 * The three constants are passed rather than duplicated in SQL: they are
 * exported from this module and read by the sign-in action for its message,
 * so this file stays the single place they are written down.
 */
export async function recordFailedSignIn(accountId: string): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin.rpc('record_failed_sign_in', {
    p_account_id: accountId,
    p_window_minutes: FAILURE_WINDOW_MINUTES,
    p_max_failures: MAX_FAILED_SIGN_INS,
    p_cooldown_minutes: COOLDOWN_MINUTES,
  });

  // Never thrown to the caller. A throttle that cannot record a failure must
  // not also refuse the sign-in attempt -- the person at the counter typed the
  // wrong password, and that is the answer they need. It is worth an operator
  // knowing about, so it goes to the log.
  if (error) {
    reportError('recordFailedSignIn', error, { extra: { account_id: accountId } });
  }
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

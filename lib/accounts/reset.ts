import 'server-only';

import { reportError } from '@/lib/report-error';
import { generateResetToken, hashResetToken } from '@/lib/credentials.server';
import { appBaseUrl } from '@/lib/env';
import { resetPasswordMail, sendMail } from '@/lib/mailer';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Password reset by emailed link.
 *
 * The properties that matter, and why:
 *
 *   sha256 of 256 random bits, hash only in the database
 *     A backup, a leaked service key or an administrator browsing tables must
 *     not yield a working link. There is no dictionary to defend against here,
 *     so a work factor would only slow down the person waiting for the page.
 *
 *   60 minute TTL, single use, previous tokens BURNT rather than deleted
 *     Burning keeps "already used" and "never existed" the same answer, so
 *     neither is a signal. Deleting would make the row's absence informative.
 *
 *   3 requests per account per hour
 *     A reset form with no ceiling is a way to send somebody a hundred emails
 *     from your infrastructure.
 *
 *   The token travels in the PATH, never a query string
 *     Query strings end up in server logs, in Referer headers on any outbound
 *     link from the page, and in browser history sync.
 *
 *   The base URL comes from server config, never from a request header
 *     Host and X-Forwarded-Host are attacker-controlled. A reset link built
 *     from them points wherever the attacker likes, and the victim clicking
 *     their own real email hands over a valid token. See lib/env.ts.
 *
 *   The response is identical whether or not the address matches an account
 *     Otherwise the form is an oracle for which addresses belong to staff.
 */

export const RESET_TTL_MINUTES = 60;
export const MAX_RESETS_PER_HOUR = 3;

/**
 * Always resolves. The caller shows the same "check your inbox" message
 * whatever happened, and anything worth an operator's attention goes to the
 * server log rather than to the screen.
 */
export async function requestPasswordReset(input: {
  contactEmail: string;
  requestedIp: string | null;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: account } = await admin
    .from('staff_accounts')
    .select('id, hospital_id, contact_email, disabled_at')
    .eq('contact_email', input.contactEmail)
    .maybeSingle();

  // No account, or a revoked one. Return quietly: a disabled account that
  // could still complete a reset would be a way back in.
  if (!account || account.disabled_at) return;

  const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from('password_reset_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account.id)
    .gte('created_at', anHourAgo);

  if ((count ?? 0) >= MAX_RESETS_PER_HOUR) {
    console.warn(`[reset] rate limit reached for account ${account.id}`);
    return;
  }

  // Burn anything still outstanding. A person who asks twice should not be
  // holding two live links, and the older one is the one more likely to have
  // been seen by somebody else.
  await admin
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('account_id', account.id)
    .is('used_at', null);

  const { token, hash } = generateResetToken();

  const inserted = await admin.from('password_reset_tokens').insert({
    hospital_id: account.hospital_id,
    account_id: account.id,
    token_hash: hash,
    expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString(),
    requested_ip: input.requestedIp,
  });

  if (inserted.error) {
    // Structured, and deliberately WITHOUT the token: only its sha256 is
    // ever stored, and a reset link in a log file is an account takeover
    // waiting for whoever can read the log.
    reportError('requestPasswordReset', inserted.error, {
      hospitalId: account.hospital_id,
      extra: { stage: 'store_token', account_id: account.id },
    });
    return;
  }

  const { data: hospital } = await admin
    .from('hospitals')
    .select('name')
    .eq('id', account.hospital_id)
    .maybeSingle();

  const result = await sendMail(
    resetPasswordMail({
      to: account.contact_email,
      hospitalName: hospital?.name ?? 'the hospital',
      // In the path. Never ?token=.
      link: `${appBaseUrl()}/reset-password/${token}`,
      minutes: RESET_TTL_MINUTES,
    }),
  );

  if (!result.ok) {
    // The address is not logged either. It is a real mailbox belonging to a
    // member of staff, and the account id identifies them well enough.
    reportError('requestPasswordReset', new Error(result.error), {
      hospitalId: account.hospital_id,
      extra: { stage: 'send_mail', account_id: account.id },
    });
  }
}

export type RedeemResult =
  | { ok: true; username: string }
  | { ok: false; message: string };

/**
 * Spend a reset token and set the new password.
 *
 * must_change_password is CLEARED here, not raised: the person has just chosen
 * their own password, which is the whole point of the flag. The throttle
 * counters are cleared too, or somebody who reset because they were locked out
 * would still be locked out.
 */
export async function redeemPasswordReset(input: {
  token: string;
  password: string;
}): Promise<RedeemResult> {
  const admin = createAdminClient();
  const hash = hashResetToken(input.token);

  const { data: row } = await admin
    .from('password_reset_tokens')
    .select('id, account_id, expires_at, used_at')
    .eq('token_hash', hash)
    .maybeSingle();

  // Expired, spent, superseded, or invented. One sentence for all four --
  // telling them apart tells an attacker which tokens once existed.
  const expired = row ? new Date(row.expires_at) <= new Date() : false;
  if (!row || row.used_at || expired) {
    return {
      ok: false,
      message: 'That link has expired or has already been used. Ask for a new one.',
    };
  }

  const { data: account } = await admin
    .from('staff_accounts')
    .select('id, username, auth_user_id, disabled_at')
    .eq('id', row.account_id)
    .maybeSingle();

  if (!account || !account.auth_user_id || account.disabled_at) {
    return { ok: false, message: 'That account can no longer be used. Ask an administrator.' };
  }

  const updated = await admin.auth.admin.updateUserById(account.auth_user_id, {
    password: input.password,
  });

  if (updated.error) {
    return { ok: false, message: `The password could not be changed: ${updated.error.message}` };
  }

  // Burn the token only after the password actually changed. The other order
  // spends the link on a failure and leaves the person with nothing.
  await admin
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);

  await admin
    .from('staff_accounts')
    .update({
      must_change_password: false,
      temp_password_issued_at: null,
      failed_sign_ins: 0,
      first_failed_at: null,
      locked_until: null,
    })
    .eq('id', account.id);

  return { ok: true, username: account.username };
}

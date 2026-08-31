import 'server-only';

import { randomBytes, randomInt, createHash } from 'node:crypto';

import {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
} from '@/lib/credentials';

/**
 * The half of lib/credentials.ts that needs real randomness.
 *
 * Split into its own file rather than guarded inside the shared one, because
 * `server-only` is the thing that makes "this must never reach a browser" a
 * build error instead of a code review.
 *
 * Math.random() is explicitly not used anywhere here. It is seeded per process
 * and is not a CSPRNG: two accounts provisioned seconds apart on the same
 * server can yield guessable passwords, and a reset token generated that way
 * is an account takeover waiting for somebody to notice.
 */

/**
 * A temporary password, from an alphabet with no ambiguous glyphs.
 *
 * randomInt is rejection-sampled by Node, so the distribution is uniform --
 * randomBytes()[i] % alphabet.length would not be, and the bias lands on the
 * first few characters of the alphabet.
 */
export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}

/**
 * A password reset token: 256 bits, url-safe.
 *
 * Returned as a pair. The plaintext goes in the emailed link and is then
 * forgotten; only the hash is ever written down, so a database read -- a
 * backup, a leaked service key, an administrator browsing tables -- yields
 * nothing that can be redeemed.
 */
export function generateResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashResetToken(token) };
}

/**
 * sha256, not bcrypt. The input is 256 bits of uniform randomness, so there is
 * no dictionary to slow an attacker down against and a work factor would only
 * cost the person waiting for the page to load.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

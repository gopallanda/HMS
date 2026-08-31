/**
 * Usernames, synthetic login addresses, and the rules about both.
 *
 * ONE module, imported by the login form, the provisioning action and the
 * schemas. A second implementation of buildLoginEmail() will eventually
 * disagree with the first, and the symptom is a member of staff who cannot
 * sign in while everything on screen looks correct.
 *
 * Nothing here imports from node: it runs in the browser too. Password
 * GENERATION lives in lib/credentials.server.ts, because that genuinely needs
 * crypto.randomBytes and must never be bundled for a client.
 *
 * WHY A SYNTHETIC EMAIL AT ALL
 *
 * Supabase Auth identifies a user by email address. This product identifies a
 * member of staff by a username, because a cleaner and a ward nurse in a
 * 40-bed hospital do not have work mailboxes -- that assumption is precisely
 * what broke the invitation flow this replaces. So every account gets an
 * address that exists only to satisfy Auth, is never shown to the person, and
 * never receives mail. Their real mailbox is stored separately as
 * contact_email and is used for exactly one thing: a password reset link.
 */

/** Shortest password this product will accept. Supabase enforces its own too. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The right-hand side of every synthetic address, after the hospital slug.
 *
 * Read from the environment so a deployment can own its own namespace, with a
 * default that is deliberately unroutable: `.invalid` is reserved by RFC 2606
 * exactly so it can never resolve, which means a misconfigured mailer can
 * never send a real email to a synthetic address by accident.
 *
 * NEXT_PUBLIC_, because the login form builds the same address the server
 * built at provisioning time and both halves have to agree.
 */
export const STAFF_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN?.trim() || 'staff.hms.invalid';

/**
 * A username, cleaned up. Lowercase, ascii, dots and hyphens kept, everything
 * else collapsed away.
 *
 * Not exported as the way to MINT a username -- see usernameStem for that --
 * but as the way to normalise one somebody typed into the login box, so that
 * "Pavan.Kumar " and "pavan.kumar" are the same person.
 */
export function normaliseUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
}

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

/**
 * The stem a username is built from.
 *
 * employee_code wins over the person's name, deliberately (the reference spec
 * calls this out and it is right): names collide -- a hospital with two Priya
 * Sharmas is a Tuesday, not an edge case -- and a username built from a name
 * publishes who works there to anyone who can reach the login page. A badge
 * number publishes nothing.
 *
 * The name is the fallback, not the default, for the hospital that has not
 * started issuing codes yet.
 */
export function usernameStem(input: {
  employeeCode?: string | null;
  fullName?: string | null;
}): string {
  const code = normaliseUsername(input.employeeCode ?? '');
  if (code.length >= 3) return code.slice(0, 28);

  const name = (input.fullName ?? '')
    // Titles are not part of a name and "dr.anjali.rao" reads as a mistake.
    .replace(/^\s*(dr|prof|mr|mrs|ms|miss)\.?\s+/i, '')
    .trim();

  const stem = normaliseUsername(name).replace(/\./g, '.').slice(0, 28);
  return stem.length >= 2 ? stem : 'staff';
}

/**
 * Append 2, 3, 4 ... to a stem. `taken` is asked rather than passed as a list,
 * so the caller can check the database rather than a snapshot of it.
 */
export function nextFreeUsername(stem: string, isTaken: (candidate: string) => boolean): string {
  const base = stem.slice(0, 28);
  if (!isTaken(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }

  // 999 people sharing one stem is not a collision, it is a bug upstream.
  throw new Error(`No free username for "${stem}" after 999 attempts.`);
}

/**
 * username + hospital slug -> the address Supabase Auth actually signs in.
 *
 * The slug is in the address rather than only in a column because auth.users
 * emails are unique across the whole project: without it, the first hospital
 * to provision `reception` would take that username away from every other
 * tenant forever.
 */
export function buildLoginEmail(username: string, hospitalSlug: string): string {
  return `${username}@${hospitalSlug}.${STAFF_EMAIL_DOMAIN}`;
}

/** Whether an address is one of ours rather than a real mailbox. */
export function isSyntheticLoginEmail(value: string): boolean {
  return value.trim().toLowerCase().endsWith(`.${STAFF_EMAIL_DOMAIN}`);
}

/**
 * Deliberately permissive. This exists to catch a typo, not to adjudicate
 * RFC 5322 -- a regex strict enough to be interesting rejects addresses that
 * work, and the only thing riding on it here is whether a reset link can be
 * delivered.
 */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed) && trimmed.length <= 254;
}

export type ContactEmailProblem = 'empty' | 'malformed' | 'synthetic';

/**
 * The recovery mailbox. Rejects the synthetic domain outright: an account whose
 * contact address is its own login address can never be recovered, because
 * nothing is listening at the other end.
 */
export function validateContactEmail(value: string): ContactEmailProblem | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'empty';
  if (!isValidEmail(trimmed)) return 'malformed';
  if (isSyntheticLoginEmail(trimmed)) return 'synthetic';
  return null;
}

export const CONTACT_EMAIL_MESSAGE: Record<ContactEmailProblem, string> = {
  empty: 'A contact email is required, so this account can reset its own password.',
  malformed: 'Enter a valid email address.',
  synthetic: 'That is a sign-in address, not a mailbox. Use a real email address.',
};

/**
 * The alphabet a temporary password is drawn from.
 *
 * 0/O and 1/l/I are absent on purpose. This password gets read down a phone
 * line to a ward and copied by hand off a screen onto a slip of paper; every
 * ambiguous glyph is a support call.
 */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export const TEMP_PASSWORD_LENGTH = 10;

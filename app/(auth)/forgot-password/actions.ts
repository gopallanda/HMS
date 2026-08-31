'use server';

import { headers } from 'next/headers';

import { invalid, success, type ActionState } from '@/lib/action-state';
import { requestPasswordReset } from '@/lib/accounts/reset';
import { forgotPasswordSchema } from '@/lib/schemas/account';

/**
 * Ask for a reset link.
 *
 * The response is IDENTICAL whether or not the address matches an account,
 * whether or not the account is disabled, and whether or not the hourly limit
 * has already been hit. Anything else turns this form into an oracle for which
 * addresses belong to staff at this hospital -- which is a staff list, and a
 * phishing target.
 *
 * Note what is taken from the request and what is not: the IP, for the audit
 * trail, yes. The HOST, never. The reset link is built from server
 * configuration in lib/env.ts, because a link built from an attacker-set Host
 * header points at the attacker's server and the victim clicking their own
 * genuine email hands over a working token.
 */
export async function requestReset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    contact_email: formData.get('contact_email'),
  });
  // The only failure this form reports is a malformed address, which the
  // person can see for themselves and which says nothing about who has an
  // account here.
  if (!parsed.success) return invalid(parsed.error);

  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');
  const requestedIp = forwardedFor ? forwardedFor.split(',')[0]!.trim() : null;

  await requestPasswordReset({
    contactEmail: parsed.data.contact_email,
    requestedIp,
  });

  return success(
    'If that address belongs to a staff account, a reset link is on its way. ' +
      'It works once and expires in an hour.',
  );
}

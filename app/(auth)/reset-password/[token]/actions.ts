'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { redeemPasswordReset } from '@/lib/accounts/reset';
import { resetPasswordSchema } from '@/lib/schemas/account';

/**
 * Spend a reset link.
 *
 * The token arrives in the form, having arrived on the page in the PATH. It is
 * never a query string: query strings end up in server access logs, in the
 * Referer header of any outbound link on the page, and in browser history sync.
 *
 * On success this does NOT sign the person in. They go to the login screen and
 * use the password they just chose -- which is one extra step, and is what
 * makes a stolen link worth less: possession of the email gets an attacker a
 * password change the real owner will notice, not a live session.
 */
export async function resetPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get('token')?.toString() ?? '';
  if (!token) return failure('That link is missing its token. Ask for a new one.');

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const result = await redeemPasswordReset({ token, password: parsed.data.password });

  if (!result.ok) return failure(result.message);

  redirect('/login?reason=password_changed');
}

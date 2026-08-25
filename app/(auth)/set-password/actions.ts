'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { landingFor } from '@/lib/nav';
import type { AppRole } from '@/lib/roles';
import { setPasswordSchema } from '@/lib/schemas/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Choose a password, for someone who arrived through an invitation link.
 *
 * They already have a session by the time they get here -- /auth/confirm
 * redeemed the token and set the cookie -- so this is an update to the signed-in
 * user, not a sign-in. requireSession() is deliberately not used: an invited
 * member has a membership (attach_staff_login created it before the email went
 * out), but a password reset for someone whose membership was since deactivated
 * must still be able to complete rather than bounce.
 */
export async function setPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return failure('This link has expired. Ask for a new invitation.');
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === 'weak_password' || error.code === 'same_password') {
      return failure(error.message, { password: [error.message] });
    }
    return failure(error.message);
  }

  // updateUser reissues the token, but the membership was created before this
  // request, so the claims it carries are already correct. Read them for the
  // landing decision rather than assuming a role.
  const { data: claimsData } = await supabase.auth.getClaims();
  const appMetadata = (claimsData?.claims?.app_metadata ?? {}) as Record<string, unknown>;
  const role = typeof appMetadata.role === 'string' ? (appMetadata.role as AppRole) : null;

  redirect(landingFor(role));
}

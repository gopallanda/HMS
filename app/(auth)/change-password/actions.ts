'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { landingForCaller } from '@/lib/rbac/landing';
import type { AppRole } from '@/lib/roles';
import { changePasswordSchema } from '@/lib/schemas/account';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Choosing a password, for somebody signed in with a temporary one.
 *
 * requireSession() is deliberately NOT used. Somebody whose membership was
 * deactivated while they were mid-change still has to be able to finish -- the
 * alternative is an account stuck holding a temporary password for ever, which
 * is the worst of both states.
 */
export async function changePassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = changePasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return failure('Your session has expired. Sign in again and change it then.');
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === 'weak_password' || error.code === 'same_password') {
      return failure(error.message, { password: [error.message] });
    }
    return failure(error.message);
  }

  // ---------------------------------------------------------------------
  // The password IS changed by this point. Everything below is about the
  // flag, and if THAT fails the one thing this action must not do is
  // navigate: the proxy would bounce them straight back to this screen, and
  // the only story that fits what they saw is "the change did not work".
  // So: say exactly what happened, and leave them here.
  //
  // The service role is used because staff_accounts has no update policy at
  // all -- provisioning and revocation are the only things that write it, and
  // both go through trusted server code. A self-service update policy would
  // be a policy that lets a session clear its own forced-change flag.
  // ---------------------------------------------------------------------
  const admin = createAdminClient();
  const cleared = await admin
    .from('staff_accounts')
    .update({ must_change_password: false, temp_password_issued_at: null })
    .eq('auth_user_id', userData.user.id);

  if (cleared.error) {
    return failure(
      `Your password was changed, but this account is still marked as needing a new one ` +
        `(${cleared.error.message}). Tell an administrator before you carry on -- do not ` +
        `change it again, it worked.`,
    );
  }

  // updateUser reissues the token; the claims it carries were already correct,
  // so read them for the landing decision rather than assuming a role.
  const { data: claimsData } = await supabase.auth.getClaims();
  const appMetadata = (claimsData?.claims?.app_metadata ?? {}) as Record<string, unknown>;
  const role = typeof appMetadata.role === 'string' ? (appMetadata.role as AppRole) : null;

  redirect(await landingForCaller(supabase, role));
}

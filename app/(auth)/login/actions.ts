'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import {
  isLockedOut,
  recordFailedSignIn,
  recordSuccessfulSignIn,
  resolveUsername,
  COOLDOWN_MINUTES,
} from '@/lib/accounts/sign-in';
import { landingForCaller } from '@/lib/rbac/landing';
import type { AppRole } from '@/lib/roles';
import { provisionHospital } from '@/lib/rpc/onboarding';
import { asUsername, looksLikeEmail, signInSchema } from '@/lib/schemas/account';
import { createClient } from '@/lib/supabase/server';

/**
 * Signing in.
 *
 * The person types a USERNAME. There is no invitation email in this product any
 * more, so there is no address for them to remember -- they were handed
 * "pavan.kumar" and a temporary password at the desk, and the synthetic
 * address that username resolves to is never shown to them.
 *
 * An email address still works, for exactly one population: whoever created
 * the hospital through /signup, before there was a staff record to build a
 * username from.
 *
 * EVERY failure returns the SAME sentence. Distinguishing "no such username"
 * from "wrong password" turns this form into a staff directory for anyone who
 * can reach it.
 */

/** The one thing this form ever says about a failure. */
const BLENDED_FAILURE = 'Incorrect username or password.';

/**
 * Only same-origin absolute paths may be followed after login. Without this a
 * crafted ?next=https://evil.example turns the login page into an open
 * redirect, and a phished staff member never notices the hop.
 */
function safeNext(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  if (value === '/login') return null;
  if (value === '/signup') return null;
  return value;
}

export async function signIn(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const next = safeNext(formData.get('next'));

  // ---- The founder path: an email, no staff_accounts row ------------------
  if (looksLikeEmail(parsed.data.identifier)) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.identifier,
      password: parsed.data.password,
    });

    if (error) {
      return failure(BLENDED_FAILURE, {
        identifier: ['Check what you typed and try again.'],
      });
    }

    return finishSignIn(supabase, data.user.id, next);
  }

  // ---- The staff path: a username -----------------------------------------
  const username = asUsername(parsed.data.identifier);
  const account = await resolveUsername(username);

  // No such username. Same sentence, and deliberately no throttle record --
  // there is no account to throttle, and inventing one would leak which
  // usernames exist through timing.
  if (!account) {
    return failure(BLENDED_FAILURE, { identifier: ['Check what you typed and try again.'] });
  }

  if (isLockedOut(account)) {
    // This one IS specific, and on purpose: it is not a hint about whether the
    // password was right, and the alternative is somebody typing the correct
    // password five more times while the software says nothing useful.
    return failure(
      `Too many attempts. This account is locked for ${COOLDOWN_MINUTES} minutes. ` +
        'An administrator can reset the password to unlock it sooner.',
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: account.loginEmail,
    password: parsed.data.password,
  });

  if (error) {
    await recordFailedSignIn(account.id);
    return failure(BLENDED_FAILURE, { identifier: ['Check what you typed and try again.'] });
  }

  // Re-read rather than trusting what was resolved a moment ago: revoking
  // access is one write, and it has to take effect on the very next sign-in
  // even if it landed in between.
  const current = await resolveUsername(username);

  if (!current || current.disabledAt) {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/access-denied?reason=revoked');
  }

  await recordSuccessfulSignIn(current.id);

  if (current.mustChangePassword) {
    // Not a courtesy redirect -- the proxy enforces this on every route, so a
    // deep link past it comes straight back. This is just the polite version.
    redirect('/change-password');
  }

  return finishSignIn(supabase, data.user.id, next);
}

/**
 * The part both paths share: make sure the token actually carries a hospital,
 * and send the person somewhere they can work.
 *
 * A signup whose email needed confirming had no session at the moment it was
 * created, so its hospital could not be provisioned then. The details were
 * parked on the auth.users row, and this is the first moment there is an
 * authenticated caller to act on them. provision_hospital returns null for
 * anybody not in that situation and is idempotent, so a repeated sign-in
 * cannot mint a second hospital.
 */
async function finishSignIn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  next: string | null,
): Promise<ActionState> {
  const { data: claimsData } = await supabase.auth.getClaims();
  const appMetadata = (claimsData?.claims?.app_metadata ?? {}) as Record<string, unknown>;
  const hospitalId =
    typeof appMetadata.hospital_id === 'string' ? appMetadata.hospital_id : null;
  const role = typeof appMetadata.role === 'string' ? (appMetadata.role as AppRole) : null;

  if (!hospitalId || !role) {
    const { data: provisionedId, error: provisionError } = await provisionHospital(supabase);

    if (provisionError) {
      await supabase.auth.signOut({ scope: 'local' });
      return failure(`Your hospital could not be set up: ${provisionError.message}`);
    }

    if (provisionedId) {
      // The token in hand was issued before the membership existed and still
      // says hospital_id null.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut({ scope: 'local' });
        return failure(
          `Your hospital was set up, but this session did not pick it up: ${refreshError.message} Sign in again.`,
        );
      }
      redirect(next ?? '/');
    }

    // Two very different causes, and the fix for one is useless for the other,
    // so tell them apart by looking at what the user actually has. The
    // memberships_select_self policy makes this readable without any claim.
    const { data: memberships } = await supabase
      .from('memberships')
      .select('hospital_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1);

    await supabase.auth.signOut({ scope: 'local' });

    if (memberships && memberships.length > 0) {
      return failure(
        'Your account has a hospital, but this project is not putting it in the access token. ' +
          'Enable Authentication -> Hooks -> Customize Access Token (JWT) Claims ' +
          '(public.custom_access_token_hook), then sign in again.',
      );
    }

    return failure(
      'This account is not an active member of any hospital. Ask an administrator to add you.',
    );
  }

  // Outside any try/catch: redirect() signals by throwing.
  redirect(next ?? (await landingForCaller(supabase, role)));
}

'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { ensureFounderAccount } from '@/lib/accounts/founder';
import {
  isLockedOut,
  recordFailedSignIn,
  recordSuccessfulSignIn,
  resolveLoginEmail,
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

  // ---- The founder path: an email --------------------------------------------
  //
  // This branch used to be "an email, and therefore no account row" -- it signed
  // in through Supabase Auth and nothing else. That was the hole: no lockout, no
  // disabled_at check, and no reset path, because a founder had no
  // staff_accounts row for any of the three to hang off. Founders get that row
  // now (lib/accounts/founder.ts), so this branch runs the same two checks the
  // username branch does.
  //
  // The account may still be absent -- the very first sign-in of a founder
  // created before this existed, or one whose email needed confirming and whose
  // hospital is provisioned further down. The checks are therefore conditional,
  // and ensureFounderAccount() below repairs the row for the next time.
  if (looksLikeEmail(parsed.data.identifier)) {
    const loginEmail = parsed.data.identifier;
    const account = await resolveLoginEmail(loginEmail);

    if (account && isLockedOut(account)) {
      return failure(
        `Too many attempts. This account is locked for ${COOLDOWN_MINUTES} minutes. ` +
          'An administrator can reset the password to unlock it sooner.',
      );
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: parsed.data.password,
    });

    if (error) {
      if (account) await recordFailedSignIn(account.id);
      return failure(BLENDED_FAILURE, {
        identifier: ['Check what you typed and try again.'],
      });
    }

    if (account) {
      // Re-read, exactly as the username branch does: revoking access is one
      // write and has to bite on the very next sign-in, even if it landed
      // between the resolve above and the password check.
      const current = await resolveLoginEmail(loginEmail);

      if (!current || current.disabledAt) {
        await supabase.auth.signOut({ scope: 'local' });
        redirect('/access-denied?reason=revoked');
      }

      await recordSuccessfulSignIn(current.id);

      if (current.mustChangePassword) {
        redirect('/change-password');
      }
    }

    return finishSignIn(supabase, data.user.id, next, { repairFounderAccount: true });
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
 *
 * repairFounderAccount is set by the email branch only. It writes the
 * staff_accounts row a /signup founder was never given, so that from the next
 * request on they have a username, a throttle, a disabled_at and -- the reason
 * this was found at all -- a working /forgot-password. It is idempotent and
 * costs one indexed read once the row exists, which is why it can sit on a path
 * every founder takes rather than in a migration nobody runs twice.
 */
async function finishSignIn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  next: string | null,
  options: { repairFounderAccount?: boolean } = {},
): Promise<ActionState> {
  /**
   * Never blocks the sign-in. A founder who cannot reach the hospital they
   * created is a worse failure than one whose recovery path is repaired on
   * their next visit -- and ensureFounderAccount already reports a failed write
   * to the server log, which is where the three of us will see it.
   */
  const repairFounder = async (activeHospitalId: string) => {
    if (!options.repairFounderAccount) return;
    await ensureFounderAccount({ hospitalId: activeHospitalId, userId });
  };

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
      await repairFounder(provisionedId);
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

  await repairFounder(hospitalId);

  // Outside any try/catch: redirect() signals by throwing.
  redirect(next ?? (await landingForCaller(supabase, role)));
}

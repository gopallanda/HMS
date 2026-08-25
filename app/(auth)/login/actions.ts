'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { landingFor } from '@/lib/nav';
import type { AppRole } from '@/lib/roles';
import { provisionHospital } from '@/lib/rpc/onboarding';
import { loginSchema } from '@/lib/schemas/auth';
import { createClient } from '@/lib/supabase/server';

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
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // One message for a wrong email and a wrong password. Telling them apart
    // would confirm which addresses have accounts here.
    if (error.status === 400) {
      return failure('Email or password is incorrect.', {
        password: ['Check the address and password and try again.'],
      });
    }
    return failure(error.message);
  }

  // Signing in is not the same as having somewhere to go. The claims below are
  // what RLS will enforce on the next request, so resolve them now and fail
  // here, where there is a form to explain it on.
  const { data: claimsData } = await supabase.auth.getClaims();
  const appMetadata = (claimsData?.claims?.app_metadata ?? {}) as Record<string, unknown>;
  const hospitalId =
    typeof appMetadata.hospital_id === 'string' ? appMetadata.hospital_id : null;
  const role = typeof appMetadata.role === 'string' ? (appMetadata.role as AppRole) : null;

  if (!hospitalId || !role) {
    // Before treating this as a failure: a signup whose email needed confirming
    // had no session at the moment it was created, so its hospital could not be
    // provisioned then. The details were parked on the auth.users row, and this
    // is the first moment there is an authenticated caller to act on them.
    //
    // provision_hospital returns null for anyone not in that situation, which
    // leaves the diagnosis below exactly as it was. It is idempotent, so a
    // repeated sign-in cannot mint a second hospital.
    const { data: provisionedId, error: provisionError } = await provisionHospital(supabase);

    if (provisionError) {
      await supabase.auth.signOut({ scope: 'local' });
      return failure(`Your hospital could not be set up: ${provisionError.message}`);
    }

    if (provisionedId) {
      // Same reason as in the signup action: the token in hand was issued
      // before the membership existed and still says hospital_id null.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut({ scope: 'local' });
        return failure(
          `Your hospital was set up, but this session did not pick it up: ${refreshError.message} Sign in again.`,
        );
      }
      // A founder's first sign-in. The overview carries the setup checklist.
      redirect(safeNext(formData.get('next')) ?? '/');
    }

    // Two very different causes, and the fix for one is useless for the other,
    // so tell them apart by looking at what the user actually has. The
    // memberships_select_self policy makes this readable without any claim.
    const { data: memberships } = await supabase
      .from('memberships')
      .select('hospital_id')
      .eq('user_id', data.user.id)
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
  redirect(safeNext(formData.get('next')) ?? landingFor(role));
}

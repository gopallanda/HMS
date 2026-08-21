'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { landingFor } from '@/lib/nav';
import type { AppRole } from '@/lib/roles';
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

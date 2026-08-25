import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Where every emailed link lands: invitations, email confirmations, password
 * resets.
 *
 * Supabase sends a single-use token_hash rather than a session. Exchanging it
 * has to happen server-side, in a Route Handler, because that is the only place
 * in this app that can both call verifyOtp and write the session cookie it
 * returns.
 *
 * This is the second half of the staff invite: without it the invitation email
 * is a dead end, because a token_hash in a URL means nothing to a page that
 * never redeems it.
 *
 * The Supabase email templates must point here. Dashboard -> Authentication ->
 * Email Templates -> Invite user:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password
 *
 * The default template uses {{ .ConfirmationURL }}, which goes to Supabase's
 * own verify endpoint instead and never reaches this route.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  // Same rule as the login form's ?next=: only same-origin absolute paths, or
  // an emailed link becomes an open redirect.
  const requested = searchParams.get('next');
  const next =
    requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (!tokenHash || !type) {
    redirect('/login?reason=link_invalid');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired, already used, or tampered with. All three need the same thing
    // from the user -- a fresh link -- so they get the same sentence.
    redirect('/login?reason=link_invalid');
  }

  // Outside any try/catch: redirect() signals by throwing.
  redirect(next);
}

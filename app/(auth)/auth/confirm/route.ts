import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Where a SIGNUP confirmation link lands, and nothing else any more.
 *
 * Supabase sends a single-use token_hash rather than a session. Exchanging it
 * has to happen server-side, in a Route Handler, because that is the only place
 * in this app that can both call verifyOtp and write the session cookie it
 * returns.
 *
 * WHAT NO LONGER COMES THROUGH HERE: staff invitations. The phase 1 remediation
 * removed them outright -- staff in a small hospital do not have work mailboxes
 * and will not complete an email round trip before their first shift, so
 * credentials are handed over at the desk instead (lib/accounts/provision.ts).
 * Staff password resets do not come through here either: they carry this
 * product's own token, in the path, and are redeemed at /reset-password/[token]
 * (lib/accounts/reset.ts).
 *
 * That leaves one caller -- somebody who created a hospital through /signup on
 * a project that requires email confirmation. Dashboard -> Authentication ->
 * Email Templates -> Confirm signup:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
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

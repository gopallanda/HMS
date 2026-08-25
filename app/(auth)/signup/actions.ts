'use server';

import { redirect } from 'next/navigation';

import { failure, invalid, type ActionState } from '@/lib/action-state';
import { provisionHospital } from '@/lib/rpc/onboarding';
import { signupSchema } from '@/lib/schemas/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Create an account, and with it a hospital.
 *
 * Three things have to happen in order, and the order is the whole difficulty:
 *
 *   1. auth.signUp, carrying the hospital name in user metadata. It is stored
 *      on the auth.users row, which is what lets step 2 work even when the
 *      session does not arrive until after an email confirmation.
 *   2. provision_hospital(), which creates the tenant and the membership.
 *   3. refreshSession(), because the access token minted in step 1 was issued
 *      BEFORE the membership existed and therefore carries hospital_id: null.
 *      Skip it and requireSession() bounces the user straight back to /login
 *      with "no hospital attached", one second after a successful signup.
 */
export async function signUp(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    full_name: formData.get('full_name'),
    hospital_name: formData.get('hospital_name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read back by provision_hospital() from auth.users.raw_user_meta_data.
      // Passed as metadata rather than as RPC arguments so that a caller can
      // never provision a hospital using somebody else's details.
      data: {
        full_name: parsed.data.full_name,
        hospital_name: parsed.data.hospital_name,
      },
    },
  });

  if (error) {
    if (error.code === 'user_already_exists' || error.status === 422) {
      return failure('An account already exists for that email address.', {
        email: ['Sign in instead, or use a different address.'],
      });
    }
    if (error.code === 'weak_password') {
      return failure(error.message, { password: [error.message] });
    }
    return failure(error.message);
  }

  // With email confirmation ON, Supabase returns a user with no identities for
  // an address that is already registered, rather than an error -- deliberately,
  // so signup cannot be used to enumerate accounts. Treat it the same way the
  // login form treats a bad password: say nothing that confirms the address.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    redirect('/login?reason=check_email');
  }

  // No session means the project requires email confirmation. Nothing more can
  // happen on this request -- there is no authenticated caller to run the RPC
  // as. The hospital name is safe on the auth.users row, and the login action
  // provisions on the first successful sign-in instead.
  if (!data.session) {
    redirect('/login?reason=check_email');
  }

  const { data: hospitalId, error: provisionError } = await provisionHospital(supabase);

  if (provisionError) {
    return failure(
      `Your account was created, but the hospital was not: ${provisionError.message} ` +
        'Sign in to try again.',
    );
  }

  if (!hospitalId) {
    // provision_hospital returns null only when it found no pending signup on
    // the auth.users row -- which cannot happen on the line after signUp wrote
    // one. Report it rather than redirecting into a shell with no hospital.
    return failure(
      'Your account was created, but the hospital details did not reach the database. ' +
        'Sign in to try again.',
    );
  }

  // Step 3. Without this the cookie still holds the pre-membership token.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return failure(
      `${parsed.data.hospital_name} was created, but this session did not pick it up: ` +
        `${refreshError.message} Sign in again to continue.`,
    );
  }

  // The overview, not landingFor(): a brand new hospital has no departments,
  // no doctors and no patients, and the overview is where the setup checklist
  // lives. Outside any try/catch -- redirect() signals by throwing.
  redirect('/');
}

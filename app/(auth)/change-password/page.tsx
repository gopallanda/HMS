import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { ChangePasswordForm } from './change-password-form';
import { AuthCard } from '@/components/shell/auth-card';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Choose a password',
};

/**
 * The forced password change.
 *
 * The GATE that sends people here lives in the proxy, not on this page or on
 * the pages it protects. A page-level check is bypassed by deep-linking to any
 * other route, and there are dozens of other routes.
 *
 * This page only renders the form. It does not decide whether somebody has to
 * be here -- by the time they see it, that has already been decided once, in
 * one place.
 */
export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/login?reason=signed_out');
  }

  return (
    <AuthCard
      title="Choose your password"
      subtitle="You are signed in with a temporary password. Pick your own before you carry on."
    >
      <ChangePasswordForm />
    </AuthCard>
  );
}

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { SetPasswordForm } from './set-password-form';
import { AuthCard } from '@/components/shell/auth-card';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Choose a password',
};

export default async function SetPasswordPage() {
  // Reached with a session that /auth/confirm just created. Anyone arriving
  // without one followed a stale link, or typed the URL.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/login?reason=link_invalid');
  }

  return (
    <AuthCard title="Choose a password" subtitle={data.user.email}>
      <SetPasswordForm />
    </AuthCard>
  );
}

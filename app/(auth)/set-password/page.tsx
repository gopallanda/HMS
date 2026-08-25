import { HospitalIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { SetPasswordForm } from './set-password-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HospitalIcon className="size-4" />
          </span>
          <div>
            <CardTitle className="text-base">Choose a password</CardTitle>
            <p className="text-xs text-muted-foreground">{data.user.email}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}

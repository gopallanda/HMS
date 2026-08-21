import { HospitalIcon } from 'lucide-react';
import type { Metadata } from 'next';

import { LoginForm } from './login-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign in',
};

/**
 * Reasons requireSession() bounced someone back here. Each one has a different
 * fix, so each one gets its own sentence rather than a shared "access denied".
 */
const REASON_MESSAGE: Record<string, string> = {
  signed_out: 'Your session ended. Sign in again to continue.',
  no_membership:
    'You are signed in, but no hospital is attached to your account. Ask an administrator to add you.',
  hospital_missing:
    'Your account points at a hospital this login cannot read. Ask an administrator to check your membership.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? REASON_MESSAGE[params.reason] : undefined;
  const next = typeof params.next === 'string' ? params.next : undefined;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HospitalIcon className="size-4" />
          </span>
          <div>
            <CardTitle className="text-base">Hospital Management System</CardTitle>
            <p className="text-xs text-muted-foreground">Sign in to your hospital</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        {reason ? (
          <p className="rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">{reason}</p>
        ) : null}

        <LoginForm next={next} />
      </CardContent>
    </Card>
  );
}

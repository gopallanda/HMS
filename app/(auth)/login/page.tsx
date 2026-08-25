import { InfoIcon } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { LoginForm } from './login-form';
import { AuthCard } from '@/components/shell/auth-card';

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
  // Set by the signup action when the project requires email confirmation, so
  // there was no session to create the hospital with. It is created on the
  // first sign-in instead -- nothing is lost, and the wording says so.
  check_email:
    'Check your email and confirm your address, then sign in here. Your hospital is set up on your first sign-in.',
  // /auth/confirm could not redeem the token: expired, already used, or edited.
  // All three need the same thing -- a fresh link -- so they share a sentence.
  link_invalid:
    'That link has expired or has already been used. Ask for a new invitation, or sign in below.',
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
    <AuthCard
      title="Sign in"
      subtitle="Hospital Management System"
      footer={
        <>
          New here?{' '}
          <Link
            href="/signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create a hospital
          </Link>
        </>
      }
    >
      <div className="grid gap-4">
        {reason ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{reason}</span>
          </p>
        ) : null}

        <LoginForm next={next} />
      </div>
    </AuthCard>
  );
}

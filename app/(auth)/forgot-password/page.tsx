import Link from 'next/link';
import type { Metadata } from 'next';

import { ForgotPasswordForm } from './forgot-password-form';
import { AuthCard } from '@/components/shell/auth-card';

export const metadata: Metadata = {
  title: 'Forgotten password',
};

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgotten your password?"
      subtitle="Type the email address your administrator recorded for you. It is not the same as your username."
      footer={
        <>
          Remembered it?{' '}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}

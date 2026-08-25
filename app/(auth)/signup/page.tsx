import Link from 'next/link';
import type { Metadata } from 'next';

import { SignupForm } from './signup-form';
import { AuthCard } from '@/components/shell/auth-card';

export const metadata: Metadata = {
  title: 'Create a hospital',
};

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your hospital"
      subtitle="You will be its administrator."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}

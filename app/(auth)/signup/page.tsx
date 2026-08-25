import { HospitalIcon } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { SignupForm } from './signup-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Create a hospital',
};

export default function SignupPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HospitalIcon className="size-4" />
          </span>
          <div>
            <CardTitle className="text-base">Create your hospital</CardTitle>
            <p className="text-xs text-muted-foreground">
              You will be its administrator.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        <SignupForm />

        <p className="text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

import { ShieldOffIcon } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { AuthCard } from '@/components/shell/auth-card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Access denied',
};

/**
 * Where a signed-out-and-turned-away session lands.
 *
 * Not a 403 dead end and not a silent bounce to the login page. Somebody whose
 * access was revoked mid-shift needs to know that it was revoked, not that the
 * software broke -- on a shared machine at a busy desk, "it stopped working"
 * costs an afternoon of guessing.
 */
const REASON: Record<string, { title: string; body: string }> = {
  revoked: {
    title: 'This login has been revoked',
    body: 'An administrator at your hospital has withdrawn access for this account. Nothing you did caused this, and your work is not lost.',
  },
  no_account: {
    title: 'This login has no account here',
    body: 'You signed in, but there is no staff account attached to this login at this hospital.',
  },
};

const DEFAULT = {
  title: 'You cannot open that',
  body: 'This login does not have access to the page you asked for.',
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const key = typeof params.reason === 'string' ? params.reason : '';
  const { title, body } = REASON[key] ?? DEFAULT;

  return (
    <AuthCard title={title} subtitle={body}>
      <div className="grid gap-4">
        <p className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
          <ShieldOffIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            Ask an administrator at your hospital to restore your access, or sign in with an
            account that has it.
          </span>
        </p>
        <Button asChild className="w-full" size="lg">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}

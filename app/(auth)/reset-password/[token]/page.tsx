import type { Metadata } from 'next';

import { ResetPasswordForm } from './reset-password-form';
import { AuthCard } from '@/components/shell/auth-card';

export const metadata: Metadata = {
  title: 'Choose a new password',
};

/**
 * The reset link's landing page.
 *
 * It deliberately does NOT check the token before rendering. Two reasons, and
 * the second is the important one:
 *
 *   1. Checking here and again on submit is two lookups for one answer.
 *   2. A page that says "this link is invalid" before anybody types anything is
 *      a probe: paste a guess, read the page, learn whether the token exists.
 *      Failing on submit gives the same answer for a bad token and a bad
 *      password attempt, at the same cost.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="This link works once. After you save, sign in with the new password."
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}

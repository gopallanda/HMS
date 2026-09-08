'use client';

import { ErrorCard } from '@/components/shell/error-card';

/**
 * The boundary for everything outside the signed-in shell: the auth screens
 * and /print. /(app) has its own, one level down, which keeps the sidebar.
 *
 * A separate wording, because the two audiences are different. Nobody reading
 * this is signed in, so "nothing you had already saved" would be meaningless,
 * and the recovery is to try the form again rather than to carry on working.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorCard
      error={error}
      reset={reset}
      title="This screen could not be loaded"
      description="Try again in a moment. If it keeps happening, the system needs attention from whoever set it up."
    />
  );
}

'use client';

import { ErrorCard } from '@/components/shell/error-card';

/**
 * The boundary for every signed-in screen.
 *
 * It sits INSIDE /(app), deliberately, so the sidebar survives the crash: the
 * layout above a boundary keeps rendering, and a front desk clerk whose queue
 * screen has just failed can still click through to registration. A single
 * boundary at /app would have replaced the shell as well and left them with a
 * card in an empty page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorCard error={error} reset={reset} />;
}

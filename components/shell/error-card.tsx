'use client';

import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * What a crash looks like to somebody on shift.
 *
 * Before this existed there were no error boundaries anywhere under /app, so
 * an unhandled exception -- in a page, or in a Server Action, which is how a
 * missing APP_BASE_URL surfaced when an administrator created a doctor --
 * reached the browser as the platform's own black "A server error occurred"
 * page. That page has no sidebar, no way back, and nothing a clerk can repeat
 * down the phone.
 *
 * Three things it has to do, in this order:
 *
 *   1. Not lose the person. `reset()` re-renders the segment, which is the
 *      whole fix for anything transient, and the link home is the fix for
 *      everything else. Same reasoning as a refused route redirecting home
 *      rather than to a 403 (CLAUDE.md 3.6): a dead end leaves somebody stuck
 *      at a counter with a patient in front of them.
 *   2. Say nothing about the cause. `error.message` is replaced by Next with
 *      a generic string in production anyway, and where it is not -- a client
 *      component throwing -- it is developer text that can carry an id or a
 *      connection detail. The real report already went to the server log.
 *   3. Show the digest. It is the ONE string that ties what the clerk saw to
 *      a line in the platform's log, and without it a bug report is "it broke
 *      this morning".
 */
export function ErrorCard({
  error,
  reset,
  title = 'Something went wrong',
  description = 'This screen could not be loaded. Nothing you had already saved is affected.',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <Card className="mx-auto mt-6 w-full max-w-md md:mt-12">
      <CardContent className="grid gap-4 py-4 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-destructive/10">
          <TriangleAlertIcon className="size-6 stroke-[1.5] text-destructive" />
        </span>
        <div className="grid gap-1.5">
          <p className="text-base font-semibold">{title}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-col-reverse items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button onClick={reset}>
            <RotateCwIcon data-icon="inline-start" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go to overview</Link>
          </Button>
        </div>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Quote this to whoever supports the system:{' '}
            <code className="font-mono select-all">{error.digest}</code>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

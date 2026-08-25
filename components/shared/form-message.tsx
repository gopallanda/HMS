import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react';

import type { ActionState } from '@/lib/action-state';
import { cn } from '@/lib/cn';

/**
 * The banner above a form. Never renders nothing when something went wrong --
 * an error that reaches here is an error the user sees (CLAUDE.md 7).
 *
 * Success uses the --success token rather than a literal emerald so that the
 * banner, the paid badge and the day-close totals are all the same green.
 */
export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === 'idle') return null;

  const isError = state.status === 'error';

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm',
        isError
          ? 'bg-destructive/10 text-destructive dark:bg-destructive/15'
          : 'bg-success/10 text-success dark:bg-success/15',
        className,
      )}
    >
      {isError ? (
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{state.message}</span>
    </p>
  );
}

/**
 * A standing note that is neither a failure nor a confirmation -- a duplicate
 * phone number, a trial ending, a charge already invoiced. Amber, because the
 * clerk has to decide something, not because anything broke.
 */
export function Notice({
  icon,
  className,
  children,
}: {
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning dark:bg-warning/15',
        className,
      )}
    >
      {icon ?? <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

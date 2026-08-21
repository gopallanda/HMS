import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react';

import type { ActionState } from '@/lib/action-state';
import { cn } from '@/lib/cn';

/**
 * The banner above a form. Never renders nothing when something went wrong --
 * an error that reaches here is an error the user sees (CLAUDE.md 7).
 */
export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === 'idle') return null;

  const isError = state.status === 'error';

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm',
        isError
          ? 'bg-destructive/10 text-destructive'
          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
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

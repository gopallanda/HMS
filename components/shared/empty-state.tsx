import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * Nothing here — and why.
 *
 * An empty table that renders as an empty table is indistinguishable from a
 * failed query, and staff report it as one. Every list in the app answers three
 * questions instead: what would be here, why it is not, and what to press
 * (CLAUDE.md 9 step 7 — the empty result is one of the error paths a slice has
 * to handle visibly).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** A button or link. Optional: some lists are empty because the day is young. */
  action?: React.ReactNode;
  className?: string;
  /** Less vertical air, for empty states inside a card that is already small. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-12 md:py-16',
        className,
      )}
    >
      {Icon ? (
        <Icon className="mb-3 size-10 stroke-[1.25] text-muted-foreground/30" aria-hidden />
      ) : null}
      <p className="text-base font-medium text-muted-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

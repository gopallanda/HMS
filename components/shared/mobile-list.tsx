import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * The phone's shape for a table.
 *
 * Below `md` a six-column table is a sideways scroll that nobody performs at a
 * counter, so each list screen renders its rows twice from the same data: a
 * table for the desk (`hidden md:block`) and these cards for a phone
 * (`md:hidden`). One source, two shapes -- the same pattern the queue board
 * set -- and these three pieces keep every screen's cards looking like one
 * family instead of a dozen improvisations.
 */
export function MobileList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-2.5 md:hidden', className)}>{children}</div>;
}

const CARD = 'block rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm';

/** One row as a card. With `href` the whole card is the link. */
export function MobileCard({
  children,
  className,
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href?: string;
}) {
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          CARD,
          'transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] active:bg-muted/40',
          className,
        )}
      >
        {children}
      </Link>
    );
  }
  return <div className={cn(CARD, className)}>{children}</div>;
}

/** A small label over a value, for the fact grid at the bottom of a card. */
export function MobileFact({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 gap-0.5', className)}>
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className="truncate text-sm font-medium tabular-nums">{children}</span>
    </div>
  );
}

/** The divided strip of actions along the bottom of a card. */
export function MobileActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('mt-3 flex items-center gap-2 border-t border-border/60 pt-3 *:flex-1', className)}
    >
      {children}
    </div>
  );
}

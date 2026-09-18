import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * The tones a tile may take. A closed set rather than a free `className`, so
 * four tiles in a row cannot end up as four different designs -- and so the
 * tint and the icon colour can never be set to a pair that does not read.
 */
export type StatTone = 'primary' | 'info' | 'success' | 'brand';

const TONE: Record<StatTone, string> = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  brand: 'bg-brand/15 text-brand-foreground',
};

/**
 * One number, said once.
 *
 * The label sits above the figure, not below it: these are read in a row of
 * four and the eye lands on the big number first, so the word explaining it
 * has to already be in the same glance.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'primary',
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  note?: string;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm md:rounded-xl md:p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] leading-tight font-medium tracking-wide text-muted-foreground uppercase md:text-xs">
          {label}
        </p>
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-xl md:size-9 md:rounded-lg', TONE[tone])}>
          <Icon className="size-4.5 stroke-[1.5]" aria-hidden />
        </span>
      </div>
      <p className="mt-2 truncate text-2xl leading-none font-bold tracking-tight tabular-nums md:text-3xl">
        {value}
      </p>
      {note ? <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * A shortcut to a screen. Used on the overview, where the alternative is that
 * a new clerk hunts the sidebar for the one screen they need all day.
 */
export function QuickAction({
  icon: Icon,
  label,
  description,
  href,
  tone = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  href: string;
  tone?: StatTone;
}) {
  return (
    <Link
      href={href}
      // A square tile on a phone (two to a row, thumb-sized), a row at `md`.
      className="group flex flex-col items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm transition duration-200 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] md:flex-row md:items-center md:rounded-xl md:p-4"
    >
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl md:rounded-lg', TONE[tone])}>
        <Icon className="size-5 stroke-[1.5]" aria-hidden />
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate text-sm font-semibold group-hover:text-primary md:font-medium">
          {label}
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground md:mt-0 md:block md:truncate">
          {description}
        </span>
      </span>
    </Link>
  );
}

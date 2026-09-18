import { cn } from '@/lib/cn';

/**
 * Title row for a work screen. One band of chrome, then the data -- these are
 * not marketing pages (CLAUDE.md 7).
 *
 * Actions sit on the right at `sm` and up and drop under the title below that,
 * where a 360px phone has no room for a heading and a button on one line.
 *
 * On a phone the title is the screen's large title -- the app bar above it
 * carries only the hospital -- and the rule under it goes, because the cards
 * that follow already separate themselves.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 pt-1 pb-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4 md:border-b md:border-border/60 md:pt-0 md:pb-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-balance md:truncate md:text-2xl md:font-semibold">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        // A phone gets the actions as one row of equal buttons under the title.
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:*:flex-1">{actions}</div>
      ) : null}
    </div>
  );
}

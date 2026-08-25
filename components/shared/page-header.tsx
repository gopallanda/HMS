import { cn } from '@/lib/cn';

/**
 * Title row for a work screen. One band of chrome, then the data -- these are
 * not marketing pages (CLAUDE.md 7).
 *
 * Actions sit on the right at `sm` and up and drop under the title below that,
 * where a 360px phone has no room for a heading and a button on one line.
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
        'flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl leading-tight font-semibold tracking-tight md:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

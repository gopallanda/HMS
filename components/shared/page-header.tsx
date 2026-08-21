import { cn } from '@/lib/cn';

/**
 * Title row for a work screen. One line of chrome, then the data -- these are
 * not marketing pages (CLAUDE.md 7).
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
    <div className={cn('flex flex-wrap items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

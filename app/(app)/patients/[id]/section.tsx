import { TriangleAlertIcon } from 'lucide-react';

/**
 * One band of the patient record.
 *
 * The record is built as sections that opt in by role rather than as one query
 * that half-fails, so each one needs the same three things: a heading, a place
 * for its own count, and a way to say "this part could not be read" without
 * taking the rest of the page with it (CLAUDE.md 7).
 */
export function SectionCard({
  id,
  title,
  count,
  action,
  children,
}: {
  /** Anchor target, so ?visits=all can come back to the section it expanded. */
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-6 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">
          {title}
          {count !== undefined ? (
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

/**
 * One section failed to load. The strip sits inside that section and nowhere
 * else: a patient record where the invoices did not come back is still a
 * useful patient record, and blanking the page over it would hide the visit
 * history somebody may have opened this screen for.
 */
export function SectionError({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

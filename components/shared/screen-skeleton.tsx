import { cn } from '@/lib/cn';

/**
 * The placeholder a work screen shows while its data is in flight.
 *
 * WHY THIS EXISTS
 *
 * Every page under /(app) is a Server Component that reads Postgres before it
 * renders anything at all. Without a `loading.tsx` beside it, Next.js has
 * nothing to show during that read, so the browser sits on the PREVIOUS screen
 * with no indication that the click registered. On a counter machine that
 * reads as software that ignores you, and the clerk clicks again -- which
 * starts a second render and makes it slower still.
 *
 * A skeleton does not make the query faster. It makes the navigation
 * acknowledge the click on the next frame instead of a round trip later, which
 * is the half of "slow" that a user actually reports.
 *
 * Deliberately plain: grey blocks in the shape of the screen behind them, no
 * spinner and no animation beyond the pulse. A spinner in the middle of an
 * empty page tells you nothing about what is coming; a table outline does.
 */

function Bar({ className }: { className?: string }) {
  return <div className={cn('h-4 rounded bg-muted', className)} />;
}

/** Title band, matching PageHeader's height so nothing jumps on swap. */
export function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid gap-2">
        <Bar className="h-6 w-48" />
        <Bar className="h-3.5 w-72 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Bar className="h-9 w-28 rounded-lg" />
      </div>
    </div>
  );
}

/** The filter bar most screens carry: day, status, search, Apply. */
export function FilterSkeleton() {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm md:p-4">
      <Bar className="h-10 w-44 rounded-lg" />
      <Bar className="h-10 w-32 rounded-lg" />
      <Bar className="h-10 min-w-40 flex-1 rounded-lg" />
      <Bar className="h-10 w-20 rounded-lg" />
    </div>
  );
}

/** A card row: the summary figures at the top of day close and the dashboard. */
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid gap-2 rounded-xl border border-border/60 bg-card p-4 shadow-sm md:p-5">
          <Bar className="h-3 w-20" />
          <Bar className="h-7 w-32" />
          <Bar className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** A data table with a header rule and `rows` bands. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <Bar className="h-3 w-32" />
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <Bar className="w-36 shrink-0" />
            <Bar className="min-w-0 flex-1" />
            <Bar className="hidden w-24 shrink-0 sm:block" />
            <Bar className="w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The default whole-screen placeholder: header, filters, table.
 *
 * `aria-busy` and the label are what a screen reader announces; the pulse is
 * only visible to everybody else.
 */
export function ScreenSkeleton({
  filters = true,
  stats = 0,
  rows = 6,
}: {
  filters?: boolean;
  stats?: number;
  rows?: number;
}) {
  return (
    <div className="grid animate-pulse gap-5" aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      {filters ? <FilterSkeleton /> : null}
      {stats > 0 ? <StatsSkeleton count={stats} /> : null}
      <TableSkeleton rows={rows} />
    </div>
  );
}

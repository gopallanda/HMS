import { FilterSkeleton, HeaderSkeleton, StatsSkeleton, TableSkeleton } from '@/components/shared/screen-skeleton';

/**
 * Day close: four figures, the drawer count panel, then three narrow tables.
 *
 * Worth its own file because this screen is walked a day at a time with the
 * arrows, and a placeholder shaped like the page keeps the four cards and the
 * three columns from jumping when the real numbers land.
 */
export default function Loading() {
  return (
    <div className="grid animate-pulse gap-5" aria-busy="true" aria-label="Loading day close">
      <HeaderSkeleton />
      <FilterSkeleton />
      <StatsSkeleton />
      <div className="h-36 rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <TableSkeleton rows={4} />
        <TableSkeleton rows={4} />
        <TableSkeleton rows={4} />
      </div>
    </div>
  );
}

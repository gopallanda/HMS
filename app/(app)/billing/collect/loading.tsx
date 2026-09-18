import { HeaderSkeleton, TableSkeleton } from '@/components/shared/screen-skeleton';

/** The collect desk is a visit picker beside a charge builder, not a table. */
export default function Loading() {
  return (
    <div className="grid animate-pulse gap-5" aria-busy="true" aria-label="Loading the collect desk">
      <HeaderSkeleton />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <TableSkeleton rows={6} />
        <div className="hidden h-96 rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl lg:block" />
      </div>
    </div>
  );
}

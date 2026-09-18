import { HeaderSkeleton } from '@/components/shared/screen-skeleton';

/**
 * The register desk is a search field and a form, not a list.
 *
 * Keyboard focus lands on the search box the moment the real screen mounts
 * (CLAUDE.md 7), so the placeholder deliberately shows the search row in the
 * same place -- the clerk is already typing before the form arrives.
 */
export default function Loading() {
  return (
    <div className="grid animate-pulse gap-5" aria-busy="true" aria-label="Loading the register desk">
      <HeaderSkeleton />
      <div className="h-12 rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl" />
      <div className="h-[28rem] rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl" />
    </div>
  );
}

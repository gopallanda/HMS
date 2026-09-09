import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

/** The queue board. Refreshed constantly, so a stable outline matters most. */
export default function Loading() {
  return <ScreenSkeleton stats={3} rows={8} />;
}

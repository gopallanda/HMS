import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

/** The invoice book: filters, then up to 200 rows. */
export default function Loading() {
  return <ScreenSkeleton rows={10} />;
}

import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

export default function Loading() {
  return <ScreenSkeleton stats={4} rows={8} />;
}

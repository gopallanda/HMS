import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

export default function Loading() {
  return <ScreenSkeleton stats={3} rows={8} />;
}

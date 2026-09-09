import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

export default function Loading() {
  return <ScreenSkeleton filters={false} stats={3} rows={8} />;
}

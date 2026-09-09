import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

/** Covers every administration screen: staff, roles, departments, services. */
export default function Loading() {
  return <ScreenSkeleton rows={8} />;
}

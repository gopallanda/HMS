import { ScreenSkeleton } from '@/components/shared/screen-skeleton';

/**
 * The fallback placeholder for every screen under the signed-in shell.
 *
 * Next.js only shows a loading state where a `loading.tsx` exists beside (or
 * above) the segment being navigated to. One file here means no screen can be
 * added later that navigates to a blank freeze -- the tuned ones below are an
 * improvement on this, never a prerequisite.
 */
export default function Loading() {
  return <ScreenSkeleton />;
}

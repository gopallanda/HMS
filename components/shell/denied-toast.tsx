'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Says why the screen you asked for is not the screen you got.
 *
 * The route guard in the proxy redirects a refused request to the person's own
 * landing page rather than to a 403 (block 3.2 step 7): a dead end tells a
 * clerk nothing and leaves them stuck, whereas the screen they CAN use plus
 * one sentence lets them carry on and gives them something to repeat to an
 * administrator. This is that sentence.
 *
 * Mounted once in the signed-in shell, so it works for every landing page
 * without each of them knowing about it.
 *
 * The parameter is stripped afterwards. Left in place it would re-fire on
 * every back-navigation to this page, and it would be in the URL somebody
 * copies out of the address bar to share.
 */
export function DeniedToast() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const denied = params.get('denied');

  // Sonner would otherwise show a second copy under React's development
  // double-invoke, and again on any re-render before the URL is cleaned.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!denied || shown.current === denied) return;
    shown.current = denied;

    toast.error('You do not have access to that screen', {
      description: `${denied} is not open to your role. Ask an administrator if you need it.`,
    });

    const rest = new URLSearchParams(params);
    rest.delete('denied');
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [denied, params, pathname, router]);

  return null;
}

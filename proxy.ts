import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next.js 16 renamed the root `middleware.ts` convention to `proxy.ts`.
 * The Supabase session logic itself lives at lib/supabase/middleware.ts, the
 * path CLAUDE.md section 6 specifies.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/static, _next/image  — build output
     *   favicon.ico, public assets — no session needed
     * Refreshing a token on an image request is wasted work.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

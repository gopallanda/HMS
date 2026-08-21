import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Session refresh, run on every matched request.
 *
 * Server Components cannot write cookies, so this is the only place a
 * refreshed access token can be persisted. Without it, sessions die silently
 * once the access token expires and users get logged out mid-shift.
 *
 * Next.js 16 renamed the `middleware.ts` root convention to `proxy.ts`; this
 * file keeps the name CLAUDE.md section 6 specifies and is called from
 * /proxy.ts.
 */

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ['/login', '/auth'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to the request (so this render sees the new token) and to a
          // fresh response (so the browser stores it).
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not put any logic between createServerClient and getUser(). getUser()
  // is what actually triggers the refresh; anything in between can cause
  // hard-to-debug random logouts.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back here after signing in.
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // This is an optimistic check only. It keeps unauthenticated users out of the
  // app shell; it is NOT the authorization boundary. Real enforcement is RLS
  // plus role checks in Server Actions and RPCs (CLAUDE.md 5).
  return response;
}

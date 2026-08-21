import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Uses the anon key, so every query runs as the signed-in user and RLS applies.
 * This is the default client — reach for it unless you have a specific reason
 * not to. For the RLS-bypassing client see ./admin.ts.
 *
 * A new client per request, never a module-level singleton: the client holds
 * the caller's cookies, and sharing one across requests would leak sessions
 * between users.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. This is expected and safe:
            // proxy.ts refreshes the session on every request, so the refreshed
            // tokens are written there instead. Swallowing it here would be a
            // bug only if the proxy were missing.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, or null.
 *
 * Always getUser(), never getSession(), on the server: getUser() revalidates
 * the token with the auth server, while getSession() trusts whatever the
 * cookie says.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

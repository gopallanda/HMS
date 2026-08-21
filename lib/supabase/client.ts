'use client';

import { createBrowserClient } from '@supabase/ssr';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Supabase client for Client Components.
 *
 * Anon key, so RLS applies. Use it for reads that need to be live (Realtime
 * queue updates) and for auth calls. Mutations go through Server Actions that
 * call RPCs — never write money or stock tables from here (CLAUDE.md 3.2).
 *
 * createBrowserClient is a singleton internally, so calling this repeatedly is
 * cheap and returns the same instance.
 */
export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

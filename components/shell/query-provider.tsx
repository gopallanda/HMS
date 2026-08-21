'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * TanStack Query, for the reads that happen while someone is typing.
 *
 * Server Components fetch everything that renders with a page; this cache
 * exists for the patient search, where the same three characters get typed,
 * deleted and typed again all morning. Nothing in here mutates -- writes go
 * through Server Actions that call RPCs (CLAUDE.md 3.2).
 *
 * The client is created inside useState so each browser session gets exactly
 * one. A module-level client would be shared across every request in a
 * server-rendered environment, which is how one hospital's search results end
 * up in another's cache.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A patient registered in the last half minute is still the same
            // patient. Long enough to make backspacing free, short enough that
            // nobody works from a stale record.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

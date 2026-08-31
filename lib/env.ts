import { z } from 'zod';

/**
 * Environment access, validated once, in one place.
 *
 * Validation is lazy (first access, then memoised) rather than at module load,
 * so `next build` does not require a live Supabase project. It still fails
 * loudly the first time a request actually needs a client — a half-configured
 * URL otherwise surfaces much later as an opaque fetch failure.
 *
 * NEXT_PUBLIC_* values are read as literal `process.env.X` expressions so the
 * Next.js bundler can inline them. Anything dynamic arrives as undefined in
 * the browser.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

type PublicEnv = z.infer<typeof publicSchema>;

let cached: PublicEnv | null = null;

function publicEnv(): PublicEnv {
  if (cached) return cached;

  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid Supabase environment. Check .env.local against .env.example:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }

  cached = parsed.data;
  return cached;
}

export const env = {
  get NEXT_PUBLIC_SUPABASE_URL() {
    return publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY;
  },
};

/**
 * Where this deployment lives, for building links that are EMAILED.
 *
 * Server configuration only. Never derived from the request's Host or
 * X-Forwarded-Host header: an attacker who can set those can make a password
 * reset link point at their own server, and the victim clicking their own
 * legitimate-looking email hands over a valid token. Framework origin checks
 * do not save you from this, because the email is sent before any check runs.
 *
 * Falls back to localhost in development so `next dev` needs no extra setup;
 * in production a missing value is a hard error rather than a silent
 * http://localhost:3000 in somebody's inbox.
 */
export function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'APP_BASE_URL is not set. Password reset links are built from it, and it must ' +
          'never be taken from a request header. See .env.example.',
      );
    }
    return 'http://localhost:3000';
  }

  return configured.replace(/\/+$/, '');
}

/**
 * Service role key. Server-only, and never bundled: the name has no
 * NEXT_PUBLIC_ prefix, so Next will not inline it into client code.
 * Read lazily so a missing key breaks only the admin client, not the app.
 */
export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required only by lib/supabase/admin.ts.',
    );
  }
  return key;
}

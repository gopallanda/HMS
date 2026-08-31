import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/lib/env';
import { resolveAccess, type MyAccess } from '@/lib/rbac/resolve';
import { mayOpen, roleHome } from '@/lib/rbac/routes';
import type { Database } from '@/types/database';

/**
 * The single choke point. Everything downstream trusts what this file leaves
 * behind.
 *
 * Server Components cannot write cookies, so this is also the only place a
 * refreshed access token can be persisted. Without it, sessions die silently
 * once the access token expires and users get logged out mid-shift.
 *
 * Next.js 16 renamed the `middleware.ts` root convention to `proxy.ts`; this
 * file keeps the name CLAUDE.md section 6 specifies and is called from
 * /proxy.ts.
 *
 * WHY THE GATES ARE HERE AND NOT ON A PAGE
 *
 * A page-level check protects that page. There are dozens of pages, more
 * arriving every phase, and any one of them that forgets the check is a way
 * around it -- deep-link to /billing/invoices and the forced password change
 * never happens. A choke point is the only version of this that stays true as
 * the app grows.
 *
 * THE ORDER, and each step assumes the ones above it (block 3.2):
 *
 *   1. Strip inbound identity headers, so a client can never forge what step 8
 *      writes and pages read.
 *   2. Read the session from cookies, refreshing when due, collecting the new
 *      cookies so they survive both pass-throughs and redirects.
 *   3. Verify the token. getClaims() checks the signature locally against the
 *      project's JWKS -- no auth round trip on a project using asymmetric
 *      keys, which is most of the saving the spec asks for.
 *   4. Load the role and its permissions. Revoked or disabled -> signed out.
 *   5. Forced-password-change gate.
 *   6. Signed in on a login page, or on `/` when `/` is not their home ->
 *      their own landing screen.
 *   7. Route guard: the path's required permission, longest prefix wins.
 *      Missing it redirects home with a reason, not to a 403 dead end.
 *   8. Attach the validated identity as request headers.
 *
 * COST: one RPC per authenticated request, including router prefetches. It is
 * a single indexed read behind a stable function, and it buys gates that
 * cannot be forgotten.
 *
 * The spec also suggests firing that RPC in PARALLEL with signature
 * verification, using the unverified email from the payload and discarding the
 * result if the verified claims disagree. Not done, deliberately: the RPC
 * authenticates with the access token in the cookie, so firing it before the
 * refresh in step 2 has settled means a 401 on exactly the requests where the
 * gates matter most -- the first one after an expired token. Switching
 * getUser() (a network call) for getClaims() (local verification) removes the
 * same round trip without that trade.
 */

/**
 * Paths reachable without a session. Everything else requires one.
 *
 * /access-denied is on this list precisely because the people who see it have
 * just been signed out: revoking an account signs the session out and sends
 * them here, and if this route required a session it would bounce them to
 * /login instead -- which reads as "it just logged me out again" rather than
 * as "your access was withdrawn". The page that explains a refusal cannot
 * itself be behind the thing being refused.
 */
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/auth',
  '/forgot-password',
  '/reset-password',
  '/access-denied',
];

/**
 * Public paths a SIGNED-IN user has no business sitting on. Landing on the
 * login form while already authenticated reads as "it did not work".
 *
 * /auth and /reset-password are deliberately absent: the first is a callback
 * that has to complete, and the second is how somebody who is signed in but
 * has lost their password gets a new one.
 */
const SIGNED_IN_REDIRECTS = ['/login', '/signup', '/forgot-password'];

/**
 * The only routes a session holding a temporary password may reach.
 *
 * Three, and adding a fourth needs an argument: every entry here is a page
 * somebody can sit on indefinitely without ever choosing a password.
 *
 *   /change-password  the way out
 *   /reset-password   the other way out, if they lost the temporary one too
 *   /access-denied    the dead end that has to stay reachable
 */
const FORCED_CHANGE_EXEMPT = ['/change-password', '/reset-password', '/access-denied'];

/**
 * What step 8 writes and step 1 strips.
 *
 * The strip is the whole reason a page may trust these. Without it anybody can
 * curl the app with `x-hms-permissions: settings.manage` and be believed by
 * whichever page reads the header instead of the session.
 */
export const IDENTITY_HEADERS = [
  'x-hms-user-id',
  'x-hms-hospital-id',
  'x-hms-role',
  'x-hms-staff-id',
  'x-hms-role-code',
  'x-hms-permissions',
] as const;

function matches(pathname: string, paths: readonly string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Cookies the refresh produced, applied to whichever response we end up
  // returning. Collected rather than written immediately, because a redirect
  // and a pass-through are different response objects and a refreshed token
  // has to survive both.
  let refreshedCookies: { name: string; value: string; options: object }[] = [];

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to the request as well, so anything reading cookies later in
          // this same pass sees the new token rather than the expired one.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          refreshedCookies = cookiesToSet as typeof refreshedCookies;
        },
      },
    },
  );

  // Do not put any logic between createServerClient and the claims read: that
  // read is what triggers the refresh, and anything in between can cause
  // hard-to-debug random logouts.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;

  // Step 1. Cloned AFTER the refresh so the cookie header is the current one,
  // then stripped of anything a client tried to pass in.
  const headers = new Headers(request.headers);
  for (const name of IDENTITY_HEADERS) headers.delete(name);

  const apply = <T extends NextResponse>(response: T): T => {
    for (const { name, value, options } of refreshedCookies) {
      response.cookies.set(name, value, options);
    }
    return response;
  };
  const pass = () => apply(NextResponse.next({ request: { headers } }));
  const go = (path: string, search = '') => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    return apply(NextResponse.redirect(url));
  };

  const isPublic = matches(pathname, PUBLIC_PATHS);

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Come back here after signing in.
    url.searchParams.set('next', pathname);
    return apply(NextResponse.redirect(url));
  }

  if (!claims) return pass();

  const appMetadata = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const hospitalId =
    typeof appMetadata.hospital_id === 'string' ? appMetadata.hospital_id : null;
  const membershipRole = typeof appMetadata.role === 'string' ? appMetadata.role : null;

  // Signed in with no hospital claim. The sign-in action provisions one or
  // explains why it cannot; there is nothing here to guard, and bouncing them
  // would prevent that flow from ever running.
  if (!hospitalId || !membershipRole) return pass();

  const { data } = await supabase.rpc('my_access');

  // Null means the login has no staff record in the active hospital. That is a
  // legitimate state -- a founder who provisioned their own hospital before
  // staff records existed -- and is NOT a refusal. resolveAccess() gives an
  // administrator everything and everybody else nothing, which fails closed on
  // its own.
  const access = resolveAccess((data ?? null) as MyAccess | null, membershipRole);

  if (access.accountDisabled) {
    await supabase.auth.signOut({ scope: 'local' });
    return go('/access-denied', '?reason=revoked');
  }

  // A role that does not use the software at all (Cleaner) should never have
  // been given credentials. If one somehow holds them, say so rather than
  // rendering an empty shell with nothing in the nav.
  if (!access.canLogin) {
    await supabase.auth.signOut({ scope: 'local' });
    return go('/access-denied', '?reason=no_login');
  }

  if (access.mustChangePassword && !matches(pathname, FORCED_CHANGE_EXEMPT)) {
    return go('/change-password');
  }

  const home = roleHome(access.roleCode, access.permissions);

  // Step 6. On a login page while already signed in, or on the hospital
  // dashboard when the dashboard is not this person's screen. The second half
  // is defect 1: a doctor typing the bare domain belongs on their queue.
  if (matches(pathname, SIGNED_IN_REDIRECTS)) return go(home);
  if (pathname === '/' && home !== '/') return go(home);

  if (isPublic) return pass();

  // Step 7. A refusal is a redirect home carrying a reason, not a dead end:
  // whoever typed /admin/staff wanted to do something, and the useful answer is
  // the screen they can actually use plus a sentence saying why not that one.
  // The page-level checks underneath still render the fuller card for anyone
  // who reaches a screen another way.
  if (!mayOpen(pathname, access.permissions)) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    url.search = '';
    url.searchParams.set('denied', pathname);
    return apply(NextResponse.redirect(url));
  }

  // Step 8. Validated identity, for pages that would otherwise repeat the
  // verification and the lookup. getSession() remains the authority for
  // anything needing the hospital row or the full access context; these answer
  // the cheap questions without a round trip.
  headers.set('x-hms-user-id', String(claims.sub ?? ''));
  headers.set('x-hms-hospital-id', hospitalId);
  headers.set('x-hms-role', membershipRole);
  if (access.staffId) headers.set('x-hms-staff-id', access.staffId);
  if (access.roleCode) headers.set('x-hms-role-code', access.roleCode);
  headers.set('x-hms-permissions', [...access.permissions].join(','));

  return pass();
}

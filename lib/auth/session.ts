import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { AppRole } from '@/lib/roles';
import type { Database } from '@/types/database';

/**
 * Who is asking, and on behalf of which hospital.
 *
 * hospital_id and role come from the JWT, never from a memberships lookup
 * (CLAUDE.md 3.1). That matters beyond speed: the token is exactly what RLS
 * will enforce a moment later, so if the app trusted a different source the UI
 * and the database could disagree about what the user may see.
 *
 * getClaims() verifies the token -- against the project's public JWK for
 * asymmetric keys, or by round-tripping getUser() for legacy symmetric ones --
 * so the claims below are trusted, unlike a raw getSession() decode.
 */

export type Hospital = Database['public']['Tables']['hospitals']['Row'];

export type SessionContext = {
  userId: string;
  email: string | null;
  hospitalId: string;
  role: AppRole;
  hospital: Hospital;
  /** full_name of the staff row linked to this login, when there is one. */
  staffName: string | null;
  /**
   * staff.id behind this login, or null when the login has no staff record.
   *
   * This is who the doctor module means by "me": visits.doctor_id references
   * staff, not auth.users, because a staff record exists before a login does
   * (CLAUDE.md 4). Null is a normal answer -- an administrator who never sees
   * patients still signs in, they just have no queue of their own.
   *
   * The database has its own copy of this question in public.current_staff_id(),
   * which is what save_consultation trusts. This one only decides what the
   * screen shows.
   */
  staffId: string | null;
  /**
   * The staff row's role -- the person's JOB, which is deliberately not the
   * membership role their token carries. The seeded owner is a doctor on the
   * staff list and a super_admin on her token.
   */
  staffRole: AppRole | null;
};

/** Why a request has no usable session. Each one needs a different message. */
export type SessionProblem =
  /** No session cookie, or it expired. */
  | 'signed_out'
  /** Signed in, but the token carries no hospital: no membership, or the
   *  access token hook is not enabled on this project (see README). */
  | 'no_membership'
  /** Signed in with a hospital claim that no longer resolves to a row. */
  | 'hospital_missing';

export type SessionResult =
  | { ok: true; session: SessionContext }
  | { ok: false; problem: SessionProblem };

type Claims = {
  userId: string;
  email: string | null;
  hospitalId: string | null;
  role: AppRole | null;
};

/**
 * Verified JWT claims, or null when signed out.
 *
 * cache() dedupes this per request: a layout, its page and any server action
 * on the same request share one verification instead of three.
 */
export const getClaims = cache(async (): Promise<Claims | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;

  const claims = data.claims;
  const appMetadata = (claims.app_metadata ?? {}) as Record<string, unknown>;

  const hospitalId =
    typeof appMetadata.hospital_id === 'string' && appMetadata.hospital_id !== ''
      ? appMetadata.hospital_id
      : null;
  const role =
    typeof appMetadata.role === 'string' && appMetadata.role !== ''
      ? (appMetadata.role as AppRole)
      : null;

  return {
    userId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    hospitalId,
    role,
  };
});

/**
 * Full context: claims plus the hospital row the shell renders from and the
 * staff record behind the login, if any.
 */
export const getSession = cache(async (): Promise<SessionResult> => {
  const claims = await getClaims();
  if (!claims) return { ok: false, problem: 'signed_out' };
  if (!claims.hospitalId || !claims.role) {
    return { ok: false, problem: 'no_membership' };
  }

  const supabase = await createClient();

  // Both reads go through RLS. If the token said a hospital the policies
  // disagree with, hospital comes back null and we fail closed below.
  const [hospitalResult, staffResult] = await Promise.all([
    supabase
      .from('hospitals')
      .select('*')
      .eq('id', claims.hospitalId)
      .maybeSingle(),
    supabase
      .from('staff')
      .select('id, full_name, role')
      .eq('hospital_id', claims.hospitalId)
      .eq('user_id', claims.userId)
      .maybeSingle(),
  ]);

  if (hospitalResult.error || !hospitalResult.data) {
    return { ok: false, problem: 'hospital_missing' };
  }

  return {
    ok: true,
    session: {
      userId: claims.userId,
      email: claims.email,
      hospitalId: claims.hospitalId,
      role: claims.role,
      hospital: hospitalResult.data,
      staffName: staffResult.data?.full_name ?? null,
      staffId: staffResult.data?.id ?? null,
      staffRole: staffResult.data?.role ?? null,
    },
  };
});

/**
 * For anything inside /(app). Sends the caller back to login with a reason
 * rather than rendering a shell around an empty session.
 *
 * The proxy already bounces requests with no cookie, so reaching the
 * no_membership branch means the user authenticated but has no way in --
 * a real, and loudly reported, configuration problem.
 */
export async function requireSession(): Promise<SessionContext> {
  const result = await getSession();
  if (result.ok) return result.session;
  redirect(`/login?reason=${result.problem}`);
}

/**
 * Server Actions are reachable by POST without going through any page, so
 * every one of them re-checks instead of trusting the caller (Next.js docs:
 * "Always verify authentication and authorization inside every Server
 * Function"). This throws instead of redirecting so the action can report the
 * failure to the form.
 */
export async function requireSessionForAction(): Promise<SessionContext> {
  const result = await getSession();
  if (!result.ok) {
    throw new Error(
      result.problem === 'signed_out'
        ? 'Your session has expired. Sign in again.'
        : 'This account has no active hospital membership.',
    );
  }
  return result.session;
}

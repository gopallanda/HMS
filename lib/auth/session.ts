import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { lifecycleState, type HospitalLifecycleState } from '@/lib/hospital-lifecycle';
import { cachedLoadAccess, type AccessContext } from '@/lib/rbac/access';
import type { Permission } from '@/lib/rbac/permissions';
import { roleLabel, type AppRole } from '@/lib/roles';
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
   * The person's ROLE, and what that role may do (block 1).
   *
   * Deliberately not the membership role their token carries: the membership
   * role is what RLS enforces as a coarse safety net, this is what the app
   * enforces screen by screen. The seeded owner is a doctor on the staff list
   * and a super_admin on her token, and the two answer different questions.
   *
   * Everything deciding what somebody may SEE or DO reads
   * session.access.permissions. Nothing new should branch on session.role.
   */
  access: AccessContext;
  /**
   * Whether the tenant may still write (20260825140000).
   *
   * Deliberately NOT a reason to refuse the session. A suspended hospital is
   * read-only, not locked out: the database refuses new rows and leaves
   * selects alone, so the app does the same. Staff keep reaching patient
   * records, histories and past invoices -- which in hospital software is not
   * a courtesy, it is the difference between a commercial dispute and a
   * clinical one. requireSessionForAction() below is where writes stop.
   */
  lifecycle: HospitalLifecycleState;
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
  //
  // my_access() replaced a direct read of staff here. It answers the same
  // question and also carries the role, its permission keys and the account
  // state, all of which every screen needs on the same request after block 1.
  const [hospitalResult, access] = await Promise.all([
    supabase
      .from('hospitals')
      .select('*')
      .eq('id', claims.hospitalId)
      .maybeSingle(),
    cachedLoadAccess(supabase, claims.role),
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
      staffName: access.staffName,
      staffId: access.staffId,
      access,
      lifecycle: lifecycleState(hospitalResult.data),
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

  // Every Server Action already funnels through here, which makes this the one
  // place a suspended tenant's writes can be stopped with a sentence a person
  // can act on. The database stops them too, a layer down, and would say so in
  // its own words at the end of a form the user has already filled in.
  //
  // Reads do not pass through this function, and that is the point: the block
  // is on writing, not on looking.
  if (result.session.lifecycle !== 'active') {
    throw new Error(LIFECYCLE_MESSAGE[result.session.lifecycle]);
  }

  return result.session;
}

/**
 * The permission gate for a Server Action.
 *
 * This is the REAL boundary. The nav hides what somebody cannot use, and from
 * block 3 the proxy turns them away from the route -- but a Server Action
 * answers a POST without passing through either, so every mutating action
 * checks here and nothing else is trusted (CLAUDE.md 5).
 *
 * Throws, so an action that forgets to look at the result still fails closed.
 * Actions that need to REPORT the refusal on a form use checkPermission below,
 * because Next.js masks thrown errors in production builds and a clerk would
 * otherwise see "an unexpected error occurred" where a sentence belongs.
 */
export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const session = await requireSessionForAction();
  if (!session.access.permissions.has(permission)) {
    throw new Error(permissionMessage(session, permission));
  }
  return session;
}

/** The same check, shaped for a form. */
export async function checkPermission(
  permission: Permission,
): Promise<{ ok: true; session: SessionContext } | { ok: false; message: string }> {
  const result = await getSession();
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.problem === 'signed_out'
          ? 'Your session has expired. Sign in again.'
          : 'This account has no active hospital membership.',
    };
  }

  if (result.session.lifecycle !== 'active') {
    return { ok: false, message: LIFECYCLE_MESSAGE[result.session.lifecycle] };
  }

  if (!result.session.access.permissions.has(permission)) {
    return { ok: false, message: permissionMessage(result.session, permission) };
  }

  return { ok: true, session: result.session };
}

/**
 * What to CALL the signed-in person's role on screen.
 *
 * Their staff role's name, which is the one on their contract and the one an
 * administrator will search /admin/roles for. The membership enum is the
 * fallback for a login with no staff record -- a founder, in practice.
 */
export function roleDisplayName(session: SessionContext): string {
  return session.access.roleName ?? roleLabel(session.role);
}

/**
 * Names the role rather than the permission key. On a shared machine the
 * useful half of the answer is almost always "you are signed in as somebody
 * else"; the key in brackets is for whoever gets shown the screenshot.
 */
function permissionMessage(session: SessionContext, permission: Permission): string {
  const role = session.access.roleName ?? 'This role';
  return `${role} is not allowed to do that (${permission}). Ask an administrator.`;
}

const LIFECYCLE_MESSAGE: Record<Exclude<HospitalLifecycleState, 'active'>, string> = {
  suspended:
    'This hospital is suspended, so nothing new can be saved. Existing records can still be opened and printed.',
  trial_expired:
    'The trial for this hospital has ended, so nothing new can be saved. Existing records can still be opened and printed.',
};

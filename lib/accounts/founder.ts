import 'server-only';

import { allocateUsername } from '@/lib/accounts/provision';
import { isSyntheticLoginEmail, usernameStem } from '@/lib/credentials';
import { reportError } from '@/lib/report-error';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The account row a founder never got.
 *
 * WHAT WAS WRONG
 *
 * /signup calls supabase.auth.signUp() with the person's own mailbox and then
 * provision_hospital(), which writes the hospital, the membership and the
 * founder's staff row -- and nothing else. Every OTHER login in this product is
 * created by provisionStaffAccount(), which also writes a staff_accounts row.
 * So the founder ended up a half-provisioned member of staff:
 *
 *   - requestPasswordReset() looks up staff_accounts.contact_email, matched
 *     nothing, and returned silently while the form said a link was on its way.
 *     The founder had no self-service recovery at all, and no error surfaced
 *     anywhere to say so.
 *   - No sign-in throttle: the email branch of the login action never touched
 *     staff_accounts, so the 5-in-15-minutes lockout did not apply to the one
 *     address an attacker is most likely to know.
 *   - No revocation: disabled_at is one write against a row that did not exist.
 *   - Admin -> Staff showed the founder with no account, and "Issue login"
 *     refused them because staff.user_id was already set.
 *
 * Backfilling the row fixes all four at once, which is why this is not a change
 * to the reset lookup: the missing reset was a symptom, not the defect.
 *
 * WHY login_email IS THEIR REAL ADDRESS HERE
 *
 * For desk-provisioned staff, login_email is synthetic
 * (pavan.kumar@apollo.staff.hms.invalid) because Supabase Auth identifies a
 * user by email and a ward nurse has no mailbox. A founder DOES have one, and
 * it is already the address on their auth.users row -- the address they have
 * been signing in with since the day they created the hospital. Minting a
 * synthetic address for them would mean changing their auth email, breaking the
 * credential they already use, to satisfy a naming convention.
 *
 * So the column's real meaning is "the address Auth signs this account in
 * with": synthetic for staff, their own mailbox for a founder. contact_email is
 * the same address, and that is correct rather than a shortcut -- it is a
 * genuine mailbox, which is the only thing contact_email is for. The global
 * unique indexes on lower(login_email) and lower(contact_email) then stop a
 * second account claiming it, which is the behaviour you want.
 *
 * WHERE THIS RUNS, AND WHY NOT IN provision_hospital()
 *
 * Usernames must be free across the whole DEPLOYMENT, not just the tenant,
 * because sign-in resolves a bare username with no hospital to narrow it. That
 * allocation lives in lib/credentials.ts and lib/accounts/provision.ts, and a
 * plpgsql re-implementation of it would eventually disagree with the TypeScript
 * one -- the exact failure CLAUDE.md warns about, whose symptom is a person who
 * cannot sign in while every screen looks right. So this stays in TypeScript,
 * runs immediately after provision_hospital() in the signup action, and runs
 * again, idempotently, on every email sign-in: a founder created before this
 * existed is repaired the next time they log in, with no data migration.
 *
 * It NEVER throws and never blocks a sign-in. A founder shut out of the
 * hospital they just created is a worse failure than one whose recovery path is
 * repaired on their next visit.
 */

export type FounderAccountResult =
  | { ok: true; created: boolean; username: string }
  | {
      ok: false;
      reason:
        | 'no_staff'
        | 'cannot_login'
        | 'no_login_email'
        | 'synthetic_email'
        | 'email_taken'
        | 'write_failed';
      message: string;
    };

export async function ensureFounderAccount(input: {
  hospitalId: string;
  userId: string;
}): Promise<FounderAccountResult> {
  const admin = createAdminClient();

  // The hospital comes from the caller (a session claim, or the id
  // provision_hospital just returned), never from a request body. The service
  // role has no RLS behind it, so this filter is the tenant boundary.
  const { data: staff } = await admin
    .from('staff')
    .select('id, full_name, employee_code, role_id, is_active, can_login')
    .eq('user_id', input.userId)
    .eq('hospital_id', input.hospitalId)
    .maybeSingle();

  if (!staff) {
    return {
      ok: false,
      reason: 'no_staff',
      message: 'That login has no staff record in this hospital.',
    };
  }

  // Already has one -- the common case on every sign-in after the first. One
  // read, and nothing else happens.
  const { data: existing } = await admin
    .from('staff_accounts')
    .select('id, username')
    .eq('staff_id', staff.id)
    .maybeSingle();

  if (existing) return { ok: true, created: false, username: existing.username };

  // Deactivated, or a role that does not use the software. Repairing a login
  // for either would hand back access somebody deliberately took away -- and
  // this runs on a sign-in, which is exactly when that would be noticed least.
  // The same two checks are in scripts/backfill-founder-accounts.mjs.
  const { data: role } = await admin
    .from('roles')
    .select('can_login')
    .eq('id', staff.role_id)
    .eq('hospital_id', input.hospitalId)
    .maybeSingle();

  if (!staff.is_active || staff.can_login === false || !role?.can_login) {
    return {
      ok: false,
      reason: 'cannot_login',
      message: 'That staff record is not allowed to sign in, so it gets no account row.',
    };
  }

  const { data: authUser } = await admin.auth.admin.getUserById(input.userId);
  const email = authUser?.user?.email?.trim().toLowerCase() ?? '';

  if (!email) {
    return {
      ok: false,
      reason: 'no_login_email',
      message: 'That login has no email address on it.',
    };
  }

  // A synthetic address with no account row is not a founder: it is a
  // provisioning that rolled back half way, or a row somebody removed. Writing
  // a fresh account for it would resurrect access that was deliberately taken
  // away, so this stops and says what it found.
  if (isSyntheticLoginEmail(email)) {
    return {
      ok: false,
      reason: 'synthetic_email',
      message: 'That login already uses a staff sign-in address, so it is not a founder account.',
    };
  }

  // Both columns, because both carry a global unique index and either one would
  // fail the insert. Caught here it costs a read; caught by the index it costs
  // an exception with a constraint name in it.
  const { data: loginHolder } = await admin
    .from('staff_accounts')
    .select('id')
    .eq('login_email', email)
    .maybeSingle();
  const { data: contactHolder } = await admin
    .from('staff_accounts')
    .select('id')
    .eq('contact_email', email)
    .maybeSingle();

  if (loginHolder || contactHolder) {
    return {
      ok: false,
      reason: 'email_taken',
      message: 'That email address already belongs to another account.',
    };
  }

  const username = await allocateUsername(
    admin,
    usernameStem({ employeeCode: staff.employee_code, fullName: staff.full_name }),
  );

  const inserted = await admin.from('staff_accounts').insert({
    hospital_id: input.hospitalId,
    staff_id: staff.id,
    auth_user_id: input.userId,
    login_email: email,
    contact_email: email,
    username,
    role_id: staff.role_id,
    // FALSE, unlike every desk-provisioned account. The founder chose this
    // password themselves at signup; raising the flag would bounce them
    // straight to /change-password on the proxy's forced-change gate, one
    // second after they created their hospital.
    must_change_password: false,
    temp_password_issued_at: null,
    created_by: input.userId,
  });

  if (inserted.error) {
    // Two sign-ins arriving together both saw no row and both inserted. The
    // unique index on staff_id settled it; whichever lost re-reads the winner's
    // row rather than reporting a failure that did not happen.
    if (inserted.error.code === '23505') {
      const { data: raced } = await admin
        .from('staff_accounts')
        .select('username')
        .eq('staff_id', staff.id)
        .maybeSingle();
      if (raced) return { ok: true, created: false, username: raced.username };
    }

    reportError('ensureFounderAccount', inserted.error, {
      hospitalId: input.hospitalId,
      userId: input.userId,
      extra: { stage: 'staff_account', staff_id: staff.id },
    });
    return {
      ok: false,
      reason: 'write_failed',
      message: `The account record could not be created: ${inserted.error.message}`,
    };
  }

  return { ok: true, created: true, username };
}

import 'server-only';

import {
  buildLoginEmail,
  nextFreeUsername,
  usernameStem,
  type ContactEmailProblem,
} from '@/lib/credentials';
import { reportError } from '@/lib/report-error';
import { generateTempPassword } from '@/lib/credentials.server';
import { appBaseUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';

/**
 * Issuing, resetting and revoking a staff login.
 *
 * ORDER IS THE WHOLE DESIGN. Four records have to end up consistent -- an auth
 * user, staff.user_id, a membership, and the staff_accounts row -- and there is
 * no transaction that spans Supabase Auth and Postgres. So each step undoes the
 * ones before it when it fails, and the steps are ordered so that a crash
 * between any two of them leaves a state that is safe rather than merely
 * tidy: an orphaned auth user cannot sign in to anything, because it has no
 * membership and therefore no hospital claim, and every RLS policy compares
 * against null.
 *
 * The opposite order would be the dangerous one. A staff_accounts row written
 * first, with the auth user last, is a window in which the app believes
 * somebody is authorised and Auth has never heard of them.
 *
 * This module is called only from Server Actions that have already run
 * checkPermission('accounts.provision' | 'accounts.reset_password'). It takes
 * the hospital from the caller's session, never from a request body -- the
 * whole point of the check is lost if the id it guards can be supplied by the
 * thing being guarded.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ProvisionFailure =
  | { field: 'contact_email'; problem: ContactEmailProblem | 'taken'; message: string }
  | { field: null; problem: 'staff' | 'role' | 'auth' | 'link' | 'unknown'; message: string };

export type ProvisionSuccess = {
  username: string;
  password: string;
  loginUrl: string;
  staffName: string;
};

export type ProvisionResult =
  | { ok: true; account: ProvisionSuccess }
  | { ok: false; error: ProvisionFailure };

/** How many `name2`, `name3` ... to try before falling back to a random tail. */
const USERNAME_ATTEMPTS = 20;

/**
 * A username nobody else in the DEPLOYMENT is using.
 *
 * The unique constraint on staff_accounts is scoped to the hospital, as every
 * business key is (CLAUDE.md 3.1). This check is deliberately wider: sign-in
 * takes a bare username with no hospital to narrow it, so two tenants holding
 * `reception` would make one of them unable to sign in at all. Scoping the
 * constraint and widening the allocation gives the right answer to both
 * questions -- the data model stays per tenant, and the login stays
 * unambiguous.
 */
async function allocateUsername(
  admin: Admin,
  stem: string,
): Promise<string> {
  const candidates = [stem];
  for (let i = 2; i <= USERNAME_ATTEMPTS; i += 1) candidates.push(`${stem}${i}`);

  const { data } = await admin
    .from('staff_accounts')
    .select('username')
    .in('username', candidates);

  const taken = new Set((data ?? []).map((row) => row.username.toLowerCase()));

  try {
    return nextFreeUsername(stem, (candidate) => taken.has(candidate));
  } catch {
    // Twenty people whose codes reduce to the same stem. Vanishingly unlikely,
    // and a random tail is a better answer than refusing to create the account.
    return `${stem}${Math.floor(Math.random() * 9000 + 1000)}`;
  }
}

export async function provisionStaffAccount(input: {
  hospitalId: string;
  hospitalSlug: string;
  actorId: string;
  staffId: string;
  contactEmail: string;
}): Promise<ProvisionResult> {
  const admin = createAdminClient();

  // -- The staff record, and the role it names -----------------------------
  //
  // Read with the hospital id from the SESSION in the filter. The service role
  // has no RLS behind it, so this comparison is the tenant boundary.
  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('id, full_name, employee_code, user_id, is_active, can_login, role_id, hospital_id')
    .eq('id', input.staffId)
    .eq('hospital_id', input.hospitalId)
    .maybeSingle();

  if (staffError) {
    return fail(null, 'staff', `That staff record could not be read: ${staffError.message}`);
  }
  if (!staff) {
    return fail(null, 'staff', 'That staff record is not in this hospital.');
  }
  if (!staff.is_active) {
    return fail(null, 'staff', `Reactivate ${staff.full_name} before issuing a login.`);
  }
  if (staff.user_id) {
    return fail(null, 'staff', `${staff.full_name} already has a login.`);
  }

  const { data: role } = await admin
    .from('roles')
    .select('id, code, name, can_login, legacy_role')
    .eq('id', staff.role_id)
    .eq('hospital_id', input.hospitalId)
    .maybeSingle();

  if (!role) {
    return fail(null, 'role', 'That staff record points at a role this hospital does not have.');
  }
  if (!role.can_login) {
    return fail(
      null,
      'role',
      `${role.name} does not use the software, so there is nothing to sign in to. ` +
        'Change the role first if that is wrong.',
    );
  }
  if (staff.can_login === false) {
    return fail(
      null,
      'role',
      `${staff.full_name} is marked as not using the software. Clear that on their staff record first.`,
    );
  }
  // A hospital administrator must never mint a platform super_admin -- the same
  // rule provision_hospital and the old attach_staff_login both held.
  if (role.legacy_role === 'super_admin') {
    return fail(null, 'role', 'That role cannot be given a login from here.');
  }

  // -- Uniqueness, BEFORE anything is created ------------------------------
  //
  // A clash caught here costs nothing and can name the person holding the
  // address. A clash caught after the auth user exists costs a rollback, and
  // the rollback is the part that can fail.
  const { data: emailHolder } = await admin
    .from('staff_accounts')
    .select('id, staff_id, hospital_id')
    .eq('contact_email', input.contactEmail)
    .maybeSingle();

  if (emailHolder) {
    // Only name the holder when they are in the caller's own hospital. Across
    // tenants "already in use" is all anybody is entitled to know.
    if (emailHolder.hospital_id === input.hospitalId) {
      const { data: holder } = await admin
        .from('staff')
        .select('full_name')
        .eq('id', emailHolder.staff_id)
        .maybeSingle();
      return fail(
        'contact_email',
        'taken',
        `${holder?.full_name ?? 'Another staff member'} already uses that email address.`,
      );
    }
    return fail('contact_email', 'taken', 'That email address is already in use.');
  }

  const username = await allocateUsername(
    admin,
    usernameStem({ employeeCode: staff.employee_code, fullName: staff.full_name }),
  );
  const loginEmail = buildLoginEmail(username, input.hospitalSlug);
  const password = generateTempPassword();

  // -- Step 1: the auth user -----------------------------------------------
  //
  // email_confirm: true, because there is no mailbox at the other end of a
  // synthetic address and never will be. Without it the account exists and
  // cannot sign in, which is the invitation flow's failure mode wearing a
  // different hat.
  const created = await admin.auth.admin.createUser({
    email: loginEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: staff.full_name },
  });

  if (created.error || !created.data.user) {
    // No password in the report, ever: `input` carries a generated one and
    // this file is the only place it exists in plaintext.
    reportError('provisionStaffAccount', created.error ?? new Error('no user returned'), {
      hospitalId: input.hospitalId,
      userId: input.actorId,
      extra: { stage: 'create_login', staff_id: input.staffId },
    });
    return fail(
      null,
      'auth',
      `The login could not be created: ${created.error?.message ?? 'no user was returned.'}`,
    );
  }

  const authUserId = created.data.user.id;

  const rollbackAuth = async () => {
    await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
  };

  // -- Step 2: link the staff record ---------------------------------------
  const linked = await admin
    .from('staff')
    .update({ user_id: authUserId })
    .eq('id', staff.id)
    .eq('hospital_id', input.hospitalId);

  if (linked.error) {
    reportError('provisionStaffAccount', linked.error, {
      hospitalId: input.hospitalId,
      userId: input.actorId,
      extra: { stage: 'link_staff', staff_id: input.staffId },
    });
    await rollbackAuth();
    return fail(null, 'link', `The login could not be linked: ${linked.error.message}`);
  }

  const rollbackLink = async () => {
    await admin
      .from('staff')
      .update({ user_id: null })
      .eq('id', staff.id)
      .eq('hospital_id', input.hospitalId);
  };

  // -- Step 3: the membership ----------------------------------------------
  //
  // This is what puts hospital_id and role on their JWT, and therefore what
  // every RLS policy will read. An account without it authenticates and then
  // sees nothing, which looks exactly like a broken product.
  const membership = await admin.from('memberships').upsert(
    {
      user_id: authUserId,
      hospital_id: input.hospitalId,
      role: role.legacy_role,
      is_active: true,
    },
    { onConflict: 'user_id,hospital_id' },
  );

  if (membership.error) {
    reportError('provisionStaffAccount', membership.error, {
      hospitalId: input.hospitalId,
      userId: input.actorId,
      extra: { stage: 'membership', staff_id: input.staffId },
    });
    await rollbackLink();
    await rollbackAuth();
    return fail(null, 'link', `The membership could not be created: ${membership.error.message}`);
  }

  const rollbackMembership = async () => {
    await admin
      .from('memberships')
      .update({ is_active: false })
      .eq('user_id', authUserId)
      .eq('hospital_id', input.hospitalId);
  };

  // -- Step 4: the authorisation row ---------------------------------------
  const account = await admin.from('staff_accounts').insert({
    hospital_id: input.hospitalId,
    staff_id: staff.id,
    auth_user_id: authUserId,
    login_email: loginEmail,
    contact_email: input.contactEmail,
    username,
    role_id: role.id,
    must_change_password: true,
    temp_password_issued_at: new Date().toISOString(),
    // The audit trigger records actor_id from auth.uid(), which is null for a
    // service-role write. This column is how "who provisioned whom" survives.
    created_by: input.actorId,
  });

  if (account.error) {
    reportError('provisionStaffAccount', account.error, {
      hospitalId: input.hospitalId,
      userId: input.actorId,
      extra: { stage: 'staff_account', staff_id: input.staffId },
    });
    await rollbackMembership();
    await rollbackLink();
    await rollbackAuth();
    return fail(null, 'link', `The account could not be recorded: ${account.error.message}`);
  }

  return {
    ok: true,
    account: {
      username,
      password,
      loginUrl: `${appBaseUrl()}/login`,
      staffName: staff.full_name,
    },
  };
}

export type ResetResult =
  | { ok: true; username: string; password: string; staffName: string }
  | { ok: false; message: string };

/**
 * A new temporary password, and the forced-change flag raised again.
 *
 * There is no "show the password again" anywhere in this product, which is why
 * this exists: a credential somebody has lost is a credential that has to be
 * replaced, not retrieved. Re-raising must_change_password is the other half --
 * it means a temporary password read aloud over a phone is one sign-in away
 * from being dead.
 */
export async function resetStaffPassword(input: {
  hospitalId: string;
  accountId: string;
}): Promise<ResetResult> {
  const admin = createAdminClient();

  const { data: account } = await admin
    .from('staff_accounts')
    .select('id, username, auth_user_id, staff_id, disabled_at')
    .eq('id', input.accountId)
    .eq('hospital_id', input.hospitalId)
    .maybeSingle();

  if (!account) return { ok: false, message: 'That account is not in this hospital.' };
  if (!account.auth_user_id) {
    return {
      ok: false,
      message: 'That account has no login attached. Remove it and issue a new one.',
    };
  }

  const { data: staff } = await admin
    .from('staff')
    .select('full_name')
    .eq('id', account.staff_id)
    .maybeSingle();

  const password = generateTempPassword();

  const updated = await admin.auth.admin.updateUserById(account.auth_user_id, { password });
  if (updated.error) {
    return { ok: false, message: `The password could not be changed: ${updated.error.message}` };
  }

  const flagged = await admin
    .from('staff_accounts')
    .update({
      must_change_password: true,
      temp_password_issued_at: new Date().toISOString(),
      failed_sign_ins: 0,
      first_failed_at: null,
      locked_until: null,
    })
    .eq('id', account.id)
    .eq('hospital_id', input.hospitalId);

  if (flagged.error) {
    // The password HAS changed. Saying "reset failed" here would be a lie that
    // costs somebody their afternoon, so say exactly what happened instead.
    return {
      ok: false,
      message:
        `The password was changed to a new temporary one, but the forced-change flag ` +
        `could not be set (${flagged.error.message}). Reset it again before handing it over.`,
    };
  }

  return {
    ok: true,
    username: account.username,
    password,
    staffName: staff?.full_name ?? account.username,
  };
}

/**
 * Revoking access: ONE write.
 *
 * disabled_at is checked at sign-in and again on every request, so a disabled
 * account is turned away even if it is holding a live session. That is why
 * this does not need to hunt through auth.users, staff and memberships -- and
 * why it is reversible, which matters on a Tuesday when somebody is disabled
 * by mistake.
 */
export async function setAccountEnabled(input: {
  hospitalId: string;
  accountId: string;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient();

  const { error } = await admin
    .from('staff_accounts')
    .update({ disabled_at: input.enabled ? null : new Date().toISOString() })
    .eq('id', input.accountId)
    .eq('hospital_id', input.hospitalId);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Removing a login entirely.
 *
 * AUTH USER FIRST, then the authorisation row. The other order leaves, however
 * briefly, a usable set of credentials pointing at an authorisation row that no
 * longer exists -- and "briefly" is a scheduling assumption, not a guarantee.
 * Deleting the auth user first means the worst case is a staff_accounts row
 * with nothing behind it, which cannot sign in to anything.
 *
 * The staff record itself is untouched: the person still works here.
 */
export async function removeStaffAccount(input: {
  hospitalId: string;
  accountId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient();

  const { data: account } = await admin
    .from('staff_accounts')
    .select('id, auth_user_id, staff_id')
    .eq('id', input.accountId)
    .eq('hospital_id', input.hospitalId)
    .maybeSingle();

  if (!account) return { ok: false, message: 'That account is not in this hospital.' };

  if (account.auth_user_id) {
    const deleted = await admin.auth.admin.deleteUser(account.auth_user_id);
    if (deleted.error) {
      return { ok: false, message: `The login could not be removed: ${deleted.error.message}` };
    }

    // Deliberately after the auth user is gone. A membership left behind grants
    // nothing once there is no user to carry it.
    await admin
      .from('memberships')
      .update({ is_active: false })
      .eq('user_id', account.auth_user_id)
      .eq('hospital_id', input.hospitalId);
  }

  const { error } = await admin
    .from('staff_accounts')
    .delete()
    .eq('id', account.id)
    .eq('hospital_id', input.hospitalId);

  if (error) {
    return {
      ok: false,
      message:
        `The login was removed, but its record could not be cleared (${error.message}). ` +
        'Nobody can sign in with it; try again to tidy up.',
    };
  }

  await admin
    .from('staff')
    .update({ user_id: null })
    .eq('id', account.staff_id)
    .eq('hospital_id', input.hospitalId);

  return { ok: true };
}

function fail(
  field: 'contact_email' | null,
  problem: 'staff' | 'role' | 'auth' | 'link' | 'unknown' | 'taken',
  message: string,
): ProvisionResult {
  if (field === 'contact_email') {
    return { ok: false, error: { field, problem: problem as 'taken', message } };
  }
  return {
    ok: false,
    error: { field: null, problem: problem as 'staff' | 'role' | 'auth' | 'link' | 'unknown', message },
  };
}

/** Narrow helper so the actions can keep their imports tidy. */
export type StaffAccountRow = Database['public']['Tables']['staff_accounts']['Row'];

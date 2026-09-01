'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import {
  provisionStaffAccount as provisionAccount,
  removeStaffAccount as removeAccount,
  resetStaffPassword as resetPassword,
  setAccountEnabled,
} from '@/lib/accounts/provision';
import type { CredentialState, StaffSaveState } from './credential-state';
import { appBaseUrl } from '@/lib/env';
import { checkPermission } from '@/lib/auth/session';
import {
  contactEmail as contactEmailSchema,
  provisionAccountSchema,
  resetStaffPasswordSchema,
  setAccountEnabledSchema,
} from '@/lib/schemas/account';
import { staffActivationSchema, staffSchema } from '@/lib/schemas/staff';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Staff records and the logins attached to them.
 *
 * saveStaff issues credentials in the SAME submission that creates the record,
 * for a person whose role signs in. It is one act at the desk -- an admin adds
 * somebody and turns round with a username, a temporary password and the URL
 * to hand over -- and splitting it in two is how a hospital ends up with staff
 * rows nobody can log in as. The password is minted by the action and shown
 * once; the admin never learns what the person's real password becomes,
 * because the forced change on first sign-in makes it theirs.
 *
 * A staff record is still the hospital's record of a person and still exists
 * whether or not that person ever opens the software: a role with
 * can_login = false, or a person ticked as not using the software, is created
 * exactly as before with no credentials section on the form at all.
 *
 * Every action here checks a PERMISSION from the session, not a role name. A
 * hospital that invents "Ward sister" and gives it staff.update gets a working
 * ward sister without anybody shipping anything; a hardcoded role check would
 * have locked every custom role out of everything.
 */

export async function saveStaff(
  _previous: StaffSaveState,
  formData: FormData,
): Promise<StaffSaveState> {
  const id = formData.get('id')?.toString() ?? '';
  const supabase = await createClient();

  // Creating and editing are different permissions, so which one is being
  // asked for has to be settled before the check. An id that is already on
  // file is an edit; anything else is a creation.
  const existing = id
    ? await supabase.from('staff').select('id').eq('id', id).maybeSingle()
    : { data: null };

  const allowed = await checkPermission(existing.data ? 'staff.update' : 'staff.create');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  // The doctor-specific rules (a registration number is required, a
  // consultation fee is forced to zero) depend on which role the posted id
  // names, and only the database knows that. Resolve it first, then build the
  // schema around the answer -- one set of rules, not two.
  const roleId = formData.get('role_id')?.toString() ?? '';
  const { data: role } = await supabase
    .from('roles')
    .select('id, code, name, can_login')
    .eq('id', roleId)
    .eq('hospital_id', session.hospitalId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!role) {
    return failure('Choose a role.', { role_id: ['That role is not in this hospital.'] });
  }

  const parsed = staffSchema(role.code).safeParse({
    id: formData.get('id'),
    full_name: formData.get('full_name'),
    role_id: roleId,
    department_id: formData.get('department_id'),
    employee_code: formData.get('employee_code') ?? '',
    employment_type: formData.get('employment_type'),
    phone: formData.get('phone'),
    reg_no: formData.get('reg_no'),
    consultation_fee: formData.get('consultation_fee'),
    denied_login: formData.get('denied_login'),
    is_active: formData.get('is_active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  // -- Does this submission also mint a login? ------------------------------
  //
  // Settled BEFORE the staff row is written, permission and email included, so
  // a rejected email costs nothing. The reverse order would leave a saved staff
  // record behind every typo in an address.
  const isNew = !existing.data;
  const wantsLogin =
    isNew &&
    formData.get('issue_login') === 'on' &&
    role.can_login &&
    parsed.data.can_login !== false;

  let newContactEmail = '';
  if (wantsLogin) {
    const canProvision = await checkPermission('accounts.provision');
    if (!canProvision.ok) return failure(canProvision.message);

    const email = contactEmailSchema.safeParse(formData.get('contact_email') ?? '');
    if (!email.success) {
      return failure('Check the contact email.', {
        contact_email: [email.error.issues[0]?.message ?? 'Enter a valid email address.'],
      });
    }
    newContactEmail = email.data;
  }

  const { error } = await supabase.from('staff').upsert(
    {
      id: parsed.data.id,
      hospital_id: session.hospitalId,
      full_name: parsed.data.full_name,
      role_id: parsed.data.role_id,
      department_id: parsed.data.department_id,
      employee_code: parsed.data.employee_code,
      employment_type: parsed.data.employment_type,
      phone: parsed.data.phone,
      reg_no: parsed.data.reg_no,
      consultation_fee: parsed.data.consultation_fee,
      can_login: parsed.data.can_login,
      is_active: parsed.data.is_active,
      // staff.role is derived from role_id by trigger (20260828090100), so it
      // is deliberately absent here. Writing it would be writing a value the
      // database is about to overwrite.
    },
    { onConflict: 'id' },
  );

  if (error) {
    if (`${error.message} ${error.details ?? ''}`.includes('employee_code')) {
      return failure('Another staff member already uses that employee code.', {
        employee_code: ['That code is taken.'],
      });
    }
    return failure(describeDatabaseError(error));
  }

  if (!wantsLogin) {
    refresh();
    return success(`${parsed.data.full_name} saved.`);
  }

  const issued = await provisionAccount({
    hospitalId: session.hospitalId,
    hospitalSlug: session.hospital.slug,
    actorId: session.userId,
    staffId: parsed.data.id,
    contactEmail: newContactEmail,
  });

  // The record IS saved either way, and saying so is the difference between an
  // admin retrying the login and an admin retyping the whole person. The row is
  // on the page by the time they read this, with Issue login sitting on it.
  refresh();

  if (!issued.ok) {
    return failure(
      `${parsed.data.full_name} was saved, but the login could not be created: ` +
        `${issued.error.message} Use Issue login on their row to try again.`,
      issued.error.field === 'contact_email'
        ? { contact_email: [issued.error.message] }
        : undefined,
    );
  }

  return {
    status: 'issued',
    message: `${issued.account.staffName} can sign in now.`,
    credentials: {
      staffName: issued.account.staffName,
      username: issued.account.username,
      password: issued.account.password,
      loginUrl: issued.account.loginUrl,
    },
  };
}

/**
 * Deactivate or reactivate a staff record. Never a delete: consultation notes,
 * charges and payments all point back at a staff row (CLAUDE.md 3.5).
 *
 * Deactivating does NOT revoke a login -- that is a separate, deliberate act on
 * the account, and the dialog says so. Conflating the two would mean a person
 * who has left is still able to sign in, or a person on leave is locked out.
 */
export async function setStaffActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('staff.deactivate');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const parsed = staffActivationSchema.safeParse({
    id: formData.get('id'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const activate = formData.get('is_active') === 'true';

  const supabase = await createClient();

  const { data: staff, error: readError } = await supabase
    .from('staff')
    .select('full_name')
    .eq('id', parsed.data.id)
    .eq('hospital_id', session.hospitalId)
    .maybeSingle();

  if (readError) return failure(describeDatabaseError(readError));
  if (!staff) return failure('That staff record no longer exists.');

  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!activate && normalise(parsed.data.confirm) !== normalise(staff.full_name)) {
    return failure(`Type ${staff.full_name} to confirm.`, {
      confirm: ['That does not match the name on the record.'],
    });
  }

  const { error } = await supabase
    .from('staff')
    .update({ is_active: activate })
    .eq('id', parsed.data.id)
    .eq('hospital_id', session.hospitalId);

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${staff.full_name} ${activate ? 'reactivated' : 'deactivated'}.`);
}

/**
 * Credentials, shown once.
 *
 * CredentialState lives in ./credential-state so this file exports nothing but
 * async functions -- a `'use server'` module that exports a constant fails at
 * request time rather than at build time.
 */
export async function provisionStaffAccount(
  _previous: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const allowed = await checkPermission('accounts.provision');
  if (!allowed.ok) return { status: 'error', message: allowed.message };
  const { session } = allowed;

  const parsed = provisionAccountSchema.safeParse({
    staff_id: formData.get('staff_id'),
    contact_email: formData.get('contact_email'),
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      status: 'error',
      message: flat.formErrors[0] ?? 'Check the highlighted fields.',
      fieldErrors: flat.fieldErrors as Record<string, string[] | undefined>,
    };
  }

  // The hospital comes from the SESSION, never from the form. A manager may
  // provision only inside their own hospital, and an id in a request body is
  // not evidence of anything.
  const result = await provisionAccount({
    hospitalId: session.hospitalId,
    hospitalSlug: session.hospital.slug,
    actorId: session.userId,
    staffId: parsed.data.staff_id,
    contactEmail: parsed.data.contact_email,
  });

  if (!result.ok) {
    return {
      status: 'error',
      message: result.error.message,
      fieldErrors:
        result.error.field === 'contact_email'
          ? { contact_email: [result.error.message] }
          : undefined,
    };
  }

  refresh();
  return {
    status: 'issued',
    message: `${result.account.staffName} can sign in now.`,
    staffName: result.account.staffName,
    username: result.account.username,
    password: result.account.password,
    loginUrl: result.account.loginUrl,
  };
}

export async function resetStaffPassword(
  _previous: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const allowed = await checkPermission('accounts.reset_password');
  if (!allowed.ok) return { status: 'error', message: allowed.message };
  const { session } = allowed;

  const parsed = resetStaffPasswordSchema.safeParse({
    account_id: formData.get('account_id'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid account.' };

  const result = await resetPassword({
    hospitalId: session.hospitalId,
    accountId: parsed.data.account_id,
  });

  if (!result.ok) return { status: 'error', message: result.message };

  refresh();
  return {
    status: 'issued',
    message: `${result.staffName} has a new temporary password.`,
    staffName: result.staffName,
    username: result.username,
    password: result.password,
    loginUrl: `${appBaseUrl()}/login`,
  };
}

/**
 * Revoking or restoring access. One write, and reversible -- which matters on
 * the Tuesday somebody is disabled by mistake.
 */
export async function setStaffAccountEnabled(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('accounts.provision');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const parsed = setAccountEnabledSchema.safeParse({
    account_id: formData.get('account_id'),
    enabled: formData.get('enabled'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const enabling = parsed.data.enabled === 'true';

  const supabase = await createClient();
  const { data: account } = await supabase
    .from('staff_accounts')
    .select('id, username, staff_id')
    .eq('id', parsed.data.account_id)
    .eq('hospital_id', session.hospitalId)
    .maybeSingle();

  if (!account) return failure('That account is not in this hospital.');

  // Revoking somebody's access is destructive in the way that matters: they
  // stop being able to work. A typed username is a decision; a confirm button
  // is a reflex (CLAUDE.md 7).
  if (!enabling && parsed.data.confirm.trim().toLowerCase() !== account.username) {
    return failure(`Type ${account.username} to confirm.`, {
      confirm: ['That does not match the username.'],
    });
  }

  const result = await setAccountEnabled({
    hospitalId: session.hospitalId,
    accountId: account.id,
    enabled: enabling,
  });

  if (!result.ok) return failure(result.message);

  refresh();
  return success(
    enabling
      ? `${account.username} can sign in again.`
      : `${account.username} can no longer sign in.`,
  );
}

/**
 * Removing a login entirely, rather than disabling it.
 *
 * The staff record survives -- the person still worked here, and their name is
 * on visits and invoices. What goes is the ability to sign in.
 */
export async function removeStaffAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const allowed = await checkPermission('accounts.provision');
  if (!allowed.ok) return failure(allowed.message);
  const { session } = allowed;

  const accountId = formData.get('account_id')?.toString() ?? '';
  const confirm = (formData.get('confirm')?.toString() ?? '').trim().toLowerCase();

  const supabase = await createClient();
  const { data: account } = await supabase
    .from('staff_accounts')
    .select('id, username')
    .eq('id', accountId)
    .eq('hospital_id', session.hospitalId)
    .maybeSingle();

  if (!account) return failure('That account is not in this hospital.');

  if (confirm !== account.username) {
    return failure(`Type ${account.username} to confirm.`, {
      confirm: ['That does not match the username.'],
    });
  }

  const result = await removeAccount({
    hospitalId: session.hospitalId,
    accountId: account.id,
  });

  if (!result.ok) return failure(result.message);

  refresh();
  return success(`The login for ${account.username} has been removed.`);
}

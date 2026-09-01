'use client';

import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  ShieldOffIcon,
  UsersIcon,
} from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  provisionStaffAccount,
  removeStaffAccount,
  resetStaffPassword,
  saveStaff,
  setStaffAccountEnabled,
  setStaffActive,
} from './actions';
import { CREDENTIALS_IDLE, type StaffSaveState } from './credential-state';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { KbdHint } from '@/components/shared/kbd';
import { FormMessage } from '@/components/shared/form-message';
import { MoneyInput } from '@/components/shared/money-input';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldError, IDLE, type ActionState } from '@/lib/action-state';
import { cn } from '@/lib/cn';
import {
  chargesConsultationFee,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  type EmploymentTypeValue,
} from '@/lib/schemas/staff';
import { formatAmount } from '@/lib/utils/money';

export type StaffRow = {
  id: string;
  full_name: string;
  role_id: string;
  department_id: string | null;
  phone: string | null;
  reg_no: string | null;
  consultation_fee: number;
  is_active: boolean;
  user_id: string | null;
  can_login: boolean | null;
  employee_code: string | null;
  employment_type: EmploymentTypeValue;
};

export type RoleOption = { id: string; code: string; name: string; can_login: boolean };
export type DepartmentOption = { id: string; name: string; is_active: boolean };
export type AccountRow = {
  id: string;
  staff_id: string;
  username: string;
  contact_email: string;
  disabled_at: string | null;
  must_change_password: boolean;
  last_login_at: string | null;
};

export type StaffCapabilities = {
  create: boolean;
  update: boolean;
  deactivate: boolean;
  provision: boolean;
  resetPassword: boolean;
};

/** "Dr. Anjali Rao" -> "AR". Stands in for the photograph nobody uploads. */
function initials(name: string): string {
  return (
    name
      .replace(/^(dr|mr|mrs|ms)\.?\s+/i, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/** Radix Select cannot hold an empty value, so "no department" needs a token. */
const NO_DEPARTMENT = '__none__';

export function StaffTable({
  staff,
  roles,
  departments,
  accounts,
  can,
}: {
  staff: StaffRow[];
  roles: RoleOption[];
  departments: DepartmentOption[];
  accounts: AccountRow[];
  can: StaffCapabilities;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [deactivating, setDeactivating] = useState<StaffRow | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<StaffRow | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const roleById = useMemo(
    () => new Map(roles.map((role) => [role.id, role])),
    [roles],
  );
  const accountByStaff = useMemo(
    () => new Map(accounts.map((account) => [account.staff_id, account])),
    [accounts],
  );

  const departmentName = useMemo(() => {
    const byId = new Map(departments.map((department) => [department.id, department.name]));
    return (id: string | null) => (id ? (byId.get(id) ?? 'Unknown') : '-');
  }, [departments]);

  const blankStaff = (): StaffRow => ({
    id: crypto.randomUUID(),
    full_name: '',
    // The first role that signs in, so a new record does not default to
    // something the hospital may have renamed out from under it.
    role_id: roles.find((role) => role.can_login)?.id ?? roles[0]?.id ?? '',
    department_id: null,
    phone: null,
    reg_no: null,
    consultation_fee: 0,
    is_active: true,
    user_id: null,
    can_login: null,
    employee_code: null,
    employment_type: 'full_time',
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return staff;
    return staff.filter((person) =>
      [
        person.full_name,
        roleById.get(person.role_id)?.name ?? '',
        person.phone ?? '',
        person.reg_no ?? '',
        person.employee_code ?? '',
        accountByStaff.get(person.id)?.username ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [staff, query, roleById, accountByStaff]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (event.key.toLowerCase() === 'n' && can.create) {
        event.preventDefault();
        setEditing(blankStaff());
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // blankStaff closes over roles, which is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can.create, roles]);

  const doctorCount = staff.filter(
    (person) => person.is_active && chargesConsultationFee(roleById.get(person.role_id)?.code),
  ).length;
  const noLoginCount = staff.filter(
    (person) => person.is_active && !roleById.get(person.role_id)?.can_login,
  ).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, role, code, username"
          className="w-full sm:w-72"
          aria-label="Search staff"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {staff.length} &middot; {doctorCount} doctors &middot; {noLoginCount}{' '}
          without a login
        </span>
        <span className="ml-auto flex items-center gap-4">
          <KbdHint keys="/">search</KbdHint>
          {can.create ? <KbdHint keys="N">new</KbdHint> : null}
        </span>
        {can.create ? (
          <Button onClick={() => setEditing(blankStaff())}>
            <PlusIcon data-icon="inline-start" />
            New staff
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-36">Role</TableHead>
              <TableHead className="w-36">Department</TableHead>
              <TableHead className="w-28">Code</TableHead>
              <TableHead className="w-36">Phone</TableHead>
              <TableHead className="w-24 text-right">Fee &#8377;</TableHead>
              <TableHead className="w-36">Login</TableHead>
              <TableHead className="w-44 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="p-0">
                  <EmptyState
                    compact
                    icon={UsersIcon}
                    title={
                      staff.length === 0
                        ? 'No staff yet'
                        : `Nothing matches “${query}”`
                    }
                    description={
                      staff.length === 0
                        ? 'Add the doctors first — their consultation fee is what seeds the charge on every new visit.'
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((person) => {
                const role = roleById.get(person.role_id);
                const account = accountByStaff.get(person.id);
                const usesSoftware = (role?.can_login ?? false) && person.can_login !== false;

                return (
                  <TableRow
                    key={person.id}
                    className={cn('even:bg-muted/25', !person.is_active && 'opacity-60')}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {initials(person.full_name)}
                        </span>
                        <span className="min-w-0 truncate">{person.full_name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary">{role?.name ?? 'Unknown'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{departmentName(person.department_id)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {person.employee_code ?? '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{person.phone ?? '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {chargesConsultationFee(role?.code)
                        ? formatAmount(person.consultation_fee)
                        : '-'}
                    </TableCell>
                    <TableCell className="text-xs">
                      <LoginCell
                        account={account}
                        usesSoftware={usesSoftware}
                        legacyLogin={person.user_id !== null && !account}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {can.update ? (
                          <Button size="xs" variant="ghost" onClick={() => setEditing(person)}>
                            <PencilIcon data-icon="inline-start" />
                            Edit
                          </Button>
                        ) : null}
                        {/* Nothing to offer somebody signing in by email from
                            before this phase: there is no account row to reset
                            and issuing one would fail on staff.user_id. */}
                        {(can.provision || can.resetPassword) &&
                        usesSoftware &&
                        person.is_active &&
                        (account || person.user_id === null) ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setCredentialsFor(person)}
                          >
                            <KeyRoundIcon data-icon="inline-start" />
                            {account ? 'Login' : 'Issue login'}
                          </Button>
                        ) : null}
                        {can.deactivate ? (
                          person.is_active ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeactivating(person)}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <ReactivateButton person={person} />
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <StaffDialog
          key={editing.id}
          person={editing}
          isNew={!staff.some((row) => row.id === editing.id)}
          roles={roles}
          departments={departments}
          hasAccount={accountByStaff.has(editing.id)}
          canProvision={can.provision}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {credentialsFor ? (
        <CredentialsDialog
          key={credentialsFor.id}
          person={credentialsFor}
          account={accountByStaff.get(credentialsFor.id) ?? null}
          can={can}
          onClose={() => setCredentialsFor(null)}
        />
      ) : null}

      {deactivating ? (
        <DeactivateDialog
          key={deactivating.id}
          person={deactivating}
          hasAccount={accountByStaff.has(deactivating.id)}
          onClose={() => setDeactivating(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Four states worth telling apart at a glance.
 *
 * The fourth is the awkward one: a staff row with a user_id but no
 * staff_accounts row. Those are the people who were INVITED by email before
 * this phase removed that flow -- the hospital's founder, and anyone they
 * invited. They can still sign in with their email address, they have no
 * username, and offering to "issue a login" for them would fail on the second
 * step. Saying so is better than either lying or hiding them.
 */
function LoginCell({
  account,
  usesSoftware,
  legacyLogin,
}: {
  account: AccountRow | undefined;
  usesSoftware: boolean;
  legacyLogin: boolean;
}) {
  if (!usesSoftware) {
    return <span className="text-muted-foreground">Does not sign in</span>;
  }
  if (!account) {
    return legacyLogin ? (
      <span className="grid gap-0.5">
        <span className="text-muted-foreground">Signs in by email</span>
        <span className="text-[11px] text-muted-foreground">Issued before usernames</span>
      </span>
    ) : (
      <span className="text-muted-foreground">Not issued</span>
    );
  }
  return (
    <span className="grid gap-0.5">
      <span className="font-mono">{account.username}</span>
      {account.disabled_at ? (
        <Badge variant="outline" className="w-fit text-destructive">
          <ShieldOffIcon data-icon="inline-start" />
          Revoked
        </Badge>
      ) : account.must_change_password ? (
        <span className="text-[11px] text-muted-foreground">Temporary password</span>
      ) : null}
    </span>
  );
}

function ReactivateButton({ person }: { person: StaffRow }) {
  const [state, action] = useActionState(setStaffActive, IDLE);
  useToastOnResult(state);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={person.id} />
      <input type="hidden" name="is_active" value="true" />
      <SubmitButton size="xs" variant="ghost">
        Reactivate
      </SubmitButton>
    </form>
  );
}

function StaffDialog({
  person,
  isNew,
  roles,
  departments,
  hasAccount,
  canProvision,
  onClose,
}: {
  person: StaffRow;
  isNew: boolean;
  roles: RoleOption[];
  departments: DepartmentOption[];
  hasAccount: boolean;
  canProvision: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState<StaffSaveState, FormData>(saveStaff, IDLE);
  const [roleId, setRoleId] = useState<string>(person.role_id);
  const [departmentId, setDepartmentId] = useState<string>(person.department_id ?? NO_DEPARTMENT);
  const [deniedLogin, setDeniedLogin] = useState(person.can_login === false);
  const [issueLogin, setIssueLogin] = useState(true);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const role = roles.find((option) => option.id === roleId);
  const isDoctor = chargesConsultationFee(role?.code);

  // Whether THIS submission also mints a login. New records only: an existing
  // person's credentials are the Login dialog's business, and reissuing them
  // from an edit form is how somebody loses their password by having their
  // phone number corrected.
  const canIssueNow = isNew && canProvision && (role?.can_login ?? false) && !deniedLogin;

  /*
    The credentials, once, on the way out of the create form.

    This replaces the whole dialog rather than sitting above it: the record is
    already saved, there is nothing left to edit, and the only thing left to do
    is copy three lines before closing. There is no way back to this screen
    anywhere in the product -- if it is closed too early, the answer is Reset
    password on their row, not a hunt.
  */
  if (state.status === 'issued') {
    const { credentials } = state;
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Credentials for {credentials.staffName}</DialogTitle>
            <DialogDescription>
              Hand these over now. They are not shown again anywhere -- if they are lost, reset the
              password and issue new ones.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <CopyRow label="Sign in at" value={credentials.loginUrl} />
            <CopyRow label="Username" value={credentials.username} />
            <CopyRow label="Temporary password" value={credentials.password} mono />
          </div>

          <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            {credentials.staffName} has to choose their own password before they can reach any
            screen, so nobody else -- you included -- can open their pages afterwards.
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const lines = [
                  `Sign in at: ${credentials.loginUrl}`,
                  `Username: ${credentials.username}`,
                  `Temporary password: ${credentials.password}`,
                ].join('\n');
                navigator.clipboard.writeText(lines).then(
                  () => toast.success('All three copied.'),
                  () => toast.error('Could not copy. Copy the three lines by hand.'),
                );
              }}
            >
              <CopyIcon />
              Copy all three
            </Button>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // An inactive department should not be offered for new assignments, but a
  // person already sitting in one keeps showing it -- otherwise editing their
  // phone number would silently move them out of it.
  const departmentOptions = departments.filter(
    (department) => department.is_active || department.id === person.department_id,
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New staff record' : person.full_name}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'A staff record is a person who works here. If their role signs in, their credentials are issued as you save and shown once -- and some roles never get any.'
              : 'Their staff record. Credentials are handled from the Login dialog on their row.'}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={person.id} />
          <input type="hidden" name="role_id" value={roleId} />
          {/* Radix Select posts nothing, so the real values are posted from
              hidden inputs and the tokens stay in the UI. */}
          <input
            type="hidden"
            name="department_id"
            value={departmentId === NO_DEPARTMENT ? '' : departmentId}
          />

          <FormMessage state={state} />

          <Field label="Name" htmlFor="staff-name" error={fieldError(state, 'full_name')} required>
            <Input
              id="staff-name"
              name="full_name"
              defaultValue={person.full_name}
              maxLength={120}
              required
              autoFocus
              aria-invalid={fieldError(state, 'full_name') !== undefined}
            />
          </Field>

          {/*
            Role and department, side by side and clearly independent. This is
            the pair the previous build conflated: role decides what somebody
            may open, department decides where they sit, and a nurse in
            Cardiology and a nurse in Housekeeping hold the same role.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Role"
              htmlFor="staff-role"
              error={fieldError(state, 'role_id')}
              hint="What they do, and what they may open."
              required
            >
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger id="staff-role" className="w-full">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                      {option.can_login ? '' : ' — no login'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Department"
              htmlFor="staff-department"
              error={fieldError(state, 'department_id')}
              hint="Where they sit. Does not affect access."
            >
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="staff-department" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                  {departmentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                      {department.is_active ? '' : ' (inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Employee code"
              htmlFor="staff-employee-code"
              error={fieldError(state, 'employee_code')}
              hint="Becomes their username. Preferred over their name."
            >
              <Input
                id="staff-employee-code"
                name="employee_code"
                defaultValue={person.employee_code ?? ''}
                maxLength={30}
                placeholder="EMP0142"
                className="font-mono"
                aria-invalid={fieldError(state, 'employee_code') !== undefined}
              />
            </Field>

            <Field
              label="Employment"
              htmlFor="staff-employment"
              error={fieldError(state, 'employment_type')}
            >
              <Select name="employment_type" defaultValue={person.employment_type}>
                <SelectTrigger id="staff-employment" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {EMPLOYMENT_TYPE_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="staff-phone" error={fieldError(state, 'phone')}>
              <Input
                id="staff-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={person.phone ?? ''}
                placeholder="+91 98450 11223"
                aria-invalid={fieldError(state, 'phone') !== undefined}
              />
            </Field>

            <Field
              label="Registration number"
              htmlFor="staff-reg-no"
              error={fieldError(state, 'reg_no')}
              hint={isDoctor ? 'Prints on prescriptions.' : undefined}
              required={isDoctor}
            >
              <Input
                id="staff-reg-no"
                name="reg_no"
                defaultValue={person.reg_no ?? ''}
                maxLength={60}
                placeholder={isDoctor ? 'KMC/2011/45231' : ''}
                aria-invalid={fieldError(state, 'reg_no') !== undefined}
              />
            </Field>
          </div>

          {/* Only doctors bill a consultation. Hidden rather than disabled, and
              the schema forces the value to 0 for every other role, so a fee
              cannot survive a role change. */}
          {isDoctor ? (
            <Field
              label="Consultation fee"
              htmlFor="staff-fee"
              error={fieldError(state, 'consultation_fee')}
              hint="Seeds the consultation charge when a visit is created."
              className="max-w-48"
            >
              <MoneyInput
                id="staff-fee"
                name="consultation_fee"
                defaultValue={person.consultation_fee ? String(person.consultation_fee) : ''}
                placeholder="500.00"
                aria-invalid={fieldError(state, 'consultation_fee') !== undefined}
              />
            </Field>
          ) : (
            <input type="hidden" name="consultation_fee" value="0" />
          )}

          {/*
            The credentials half of the form. Hidden entirely -- not disabled,
            not greyed -- when the role does not use the software, because a
            greyed-out field still invites the question "why can't I?" and the
            answer is that it does not apply to this person at all.
          */}
          {role?.can_login ? (
            <div className="grid gap-3 rounded-lg border border-border/60 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  name="denied_login"
                  checked={deniedLogin}
                  onCheckedChange={(value) => setDeniedLogin(value === true)}
                  disabled={hasAccount}
                  className="mt-0.5"
                />
                <span className="grid gap-0.5">
                  <span className="font-medium">This person does not use the software</span>
                  <span className="text-xs text-muted-foreground">
                    {hasAccount
                      ? 'They already have a login. Revoke it from the Login dialog first.'
                      : 'Their role allows credentials, but this person will not be given any.'}
                  </span>
                </span>
              </label>

              {/*
                Issuing is DEFAULTED ON and can be turned off, because the case
                the default gets wrong -- a record entered a week before somebody
                starts -- is real, and Issue login on their row still covers it.
                What it must never be is the other way round: an admin who does
                not notice an optional step ends up with a staff member who
                cannot sign in and nothing on screen saying so.
              */}
              {canIssueNow ? (
                <>
                  <label className="flex items-start gap-2.5 border-t border-border/60 pt-3 text-sm">
                    <Checkbox
                      name="issue_login"
                      checked={issueLogin}
                      onCheckedChange={(value) => setIssueLogin(value === true)}
                      className="mt-0.5"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">Issue their login now</span>
                      <span className="text-xs text-muted-foreground">
                        A username and a temporary password, shown once when you save. Hand them
                        over; they choose their own password before they reach any screen.
                      </span>
                    </span>
                  </label>

                  {issueLogin ? (
                    <Field
                      label="Contact email"
                      htmlFor="staff-contact-email"
                      error={fieldError(state, 'contact_email')}
                      hint="Their real mailbox. Only ever used to send a password reset."
                      required
                    >
                      <Input
                        id="staff-contact-email"
                        name="contact_email"
                        type="email"
                        inputMode="email"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="anjali.rao@gmail.com"
                        required
                        aria-invalid={fieldError(state, 'contact_email') !== undefined}
                      />
                    </Field>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
              This role does not use the software. The staff record and roster still apply.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_active" defaultChecked={person.is_active} />
            Active
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel={canIssueNow && issueLogin ? 'Creating login...' : 'Saving...'}>
              {isNew
                ? canIssueNow && issueLogin
                  ? 'Create and issue login'
                  : 'Create staff record'
                : 'Save changes'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Issuing, resetting and revoking a login.
 *
 * The credentials are shown ONCE, here, with copy buttons, and there is no way
 * back to them anywhere in the product. That is deliberate: a password that can
 * be re-read is a password stored in plaintext, and the honest alternative --
 * reset it and hand over a new one -- takes the same ten seconds.
 */
function CredentialsDialog({
  person,
  account,
  can,
  onClose,
}: {
  person: StaffRow;
  account: AccountRow | null;
  can: StaffCapabilities;
  onClose: () => void;
}) {
  const [provisionState, provisionAction] = useActionState(
    provisionStaffAccount,
    CREDENTIALS_IDLE,
  );
  const [resetState, resetAction] = useActionState(resetStaffPassword, CREDENTIALS_IDLE);
  const [revoking, setRevoking] = useState(false);
  const [removing, setRemoving] = useState(false);

  const issued =
    provisionState.status === 'issued'
      ? provisionState
      : resetState.status === 'issued'
        ? resetState
        : null;

  if (issued) {
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Credentials for {issued.staffName}</DialogTitle>
            <DialogDescription>
              Write these down or hand over the screen now. They are not shown again anywhere --
              if they are lost, reset the password and issue new ones.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <CopyRow label="Username" value={issued.username} />
            <CopyRow label="Temporary password" value={issued.password} mono />
            <CopyRow label="Sign in at" value={issued.loginUrl} />
          </div>

          <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            They will be made to choose their own password before they can reach any screen.
          </p>

          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {account ? `Login for ${person.full_name}` : `Issue a login to ${person.full_name}`}
          </DialogTitle>
          <DialogDescription>
            {account
              ? 'Credentials are handed over at the desk. There is no invitation email.'
              : 'They are handed a username and a temporary password now, at this desk. No email is sent.'}
          </DialogDescription>
        </DialogHeader>

        {account ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5 rounded-lg border border-border/60 p-3 text-sm">
              <Row label="Username" value={account.username} mono />
              <Row label="Contact email" value={account.contact_email} />
              <Row
                label="Status"
                value={
                  account.disabled_at
                    ? 'Revoked'
                    : account.must_change_password
                      ? 'Holding a temporary password'
                      : 'Active'
                }
              />
              <Row
                label="Last signed in"
                value={
                  account.last_login_at
                    ? new Date(account.last_login_at).toLocaleString('en-IN')
                    : 'Never'
                }
              />
            </div>

            {can.resetPassword ? (
              <form action={resetAction}>
                <input type="hidden" name="account_id" value={account.id} />
                {resetState.status === 'error' ? (
                  <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {resetState.message}
                  </p>
                ) : null}
                <SubmitButton variant="outline" className="w-full" pendingLabel="Resetting...">
                  Reset password
                </SubmitButton>
              </form>
            ) : null}

            {can.provision ? (
              account.disabled_at ? (
                <EnableAccountForm accountId={account.id} onDone={onClose} />
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setRevoking((open) => !open)}
                  >
                    Revoke access
                  </Button>
                  {revoking ? (
                    <RevokeAccountForm
                      accountId={account.id}
                      username={account.username}
                      onDone={onClose}
                    />
                  ) : null}

                  <Button variant="ghost" size="sm" onClick={() => setRemoving((open) => !open)}>
                    Remove the login entirely
                  </Button>
                  {removing ? (
                    <RemoveAccountForm
                      accountId={account.id}
                      username={account.username}
                      onDone={onClose}
                    />
                  ) : null}
                </>
              )
            ) : null}
          </div>
        ) : can.provision ? (
          <form action={provisionAction} className="grid gap-4">
            <input type="hidden" name="staff_id" value={person.id} />

            {provisionState.status === 'error' ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {provisionState.message}
              </p>
            ) : null}

            <Field
              label="Contact email"
              htmlFor="contact-email"
              error={
                provisionState.status === 'error'
                  ? provisionState.fieldErrors?.contact_email?.[0]
                  : undefined
              }
              hint="Their real mailbox. Used only to send a password reset link -- never to sign in."
              required
            >
              <Input
                id="contact-email"
                name="contact_email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="anjali.rao@gmail.com"
                required
                autoFocus
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Creating...">Create login</SubmitButton>
            </DialogFooter>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            You do not have permission to issue credentials.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-sm', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm',
            mono && 'font-mono tracking-wide',
          )}
        >
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => toast.error('Could not copy. Select the text and copy it by hand.'),
            );
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

function RevokeAccountForm({
  accountId,
  username,
  onDone,
}: {
  accountId: string;
  username: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState(setStaffAccountEnabled, IDLE);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="grid gap-3 rounded-lg border border-destructive/40 p-3">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="enabled" value="false" />

      <FormMessage state={state} />

      <Field
        label={`Type "${username}" to revoke`}
        htmlFor="revoke-confirm"
        error={fieldError(state, 'confirm')}
        hint="They stop being able to sign in immediately, on this device and any other."
      >
        <Input
          id="revoke-confirm"
          name="confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          autoFocus
        />
      </Field>

      <SubmitButton
        size="sm"
        variant="destructive"
        disabled={typed.trim().toLowerCase() !== username}
        pendingLabel="Revoking..."
      >
        Revoke access
      </SubmitButton>
    </form>
  );
}

function RemoveAccountForm({
  accountId,
  username,
  onDone,
}: {
  accountId: string;
  username: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState(removeStaffAccount, IDLE);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="grid gap-3 rounded-lg border border-destructive/40 p-3">
      <input type="hidden" name="account_id" value={accountId} />

      <FormMessage state={state} />

      <Field
        label={`Type "${username}" to remove`}
        htmlFor="remove-confirm"
        error={fieldError(state, 'confirm')}
        hint="The staff record stays. Only the ability to sign in is removed, and it cannot be undone -- a new login would be a new username."
      >
        <Input
          id="remove-confirm"
          name="confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          autoFocus
        />
      </Field>

      <SubmitButton
        size="sm"
        variant="destructive"
        disabled={typed.trim().toLowerCase() !== username}
        pendingLabel="Removing..."
      >
        Remove login
      </SubmitButton>
    </form>
  );
}

function EnableAccountForm({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const [state, action] = useActionState(setStaffAccountEnabled, IDLE);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="enabled" value="true" />
      <FormMessage state={state} />
      <SubmitButton variant="outline" className="w-full" pendingLabel="Restoring...">
        Restore access
      </SubmitButton>
    </form>
  );
}

function DeactivateDialog({
  person,
  hasAccount,
  onClose,
}: {
  person: StaffRow;
  hasAccount: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(setStaffActive, IDLE);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = normalise(typed) === normalise(person.full_name);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate {person.full_name}?</DialogTitle>
          <DialogDescription>
            They stop appearing in doctor and staff lists. Nothing is deleted, and past visits,
            charges and payments keep their name.
            {hasAccount
              ? ' Their login is NOT revoked -- do that separately from the Login dialog.'
              : ''}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={person.id} />
          <input type="hidden" name="is_active" value="false" />

          <FormMessage state={state} />

          <Field
            label={`Type "${person.full_name}" to confirm`}
            htmlFor="confirm-name"
            error={fieldError(state, 'confirm')}
          >
            <Input
              id="confirm-name"
              name="confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton
              size="sm"
              variant="destructive"
              disabled={!matches}
              pendingLabel="Working..."
            >
              Deactivate
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useToastOnResult(state: ActionState) {
  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
    if (state.status === 'error') toast.error(state.message);
  }, [state]);
}

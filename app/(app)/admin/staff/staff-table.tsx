'use client';

import { KeyRoundIcon, MailPlusIcon, PencilIcon, PlusIcon, UsersIcon } from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { inviteStaff, saveStaff, setStaffActive } from './actions';
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
import { APP_ROLES, chargesConsultationFee, ROLE_LABEL, type AppRole } from '@/lib/roles';
import { INVITABLE_ROLES } from '@/lib/schemas/staff';
import { formatAmount } from '@/lib/utils/money';

export type StaffRow = {
  id: string;
  full_name: string;
  role: AppRole;
  department_id: string | null;
  phone: string | null;
  reg_no: string | null;
  consultation_fee: number;
  is_active: boolean;
  user_id: string | null;
};

export type DepartmentOption = { id: string; name: string; is_active: boolean };

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

function blankStaff(): StaffRow {
  return {
    id: crypto.randomUUID(),
    full_name: '',
    role: 'front_desk',
    department_id: null,
    phone: null,
    reg_no: null,
    consultation_fee: 0,
    is_active: true,
    user_id: null,
  };
}

export function StaffTable({
  staff,
  departments,
}: {
  staff: StaffRow[];
  departments: DepartmentOption[];
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [deactivating, setDeactivating] = useState<StaffRow | null>(null);
  const [inviting, setInviting] = useState<StaffRow | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const departmentName = useMemo(() => {
    const byId = new Map(departments.map((department) => [department.id, department.name]));
    return (id: string | null) => (id ? (byId.get(id) ?? 'Unknown') : '-');
  }, [departments]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return staff;
    return staff.filter((person) =>
      [person.full_name, ROLE_LABEL[person.role], person.phone ?? '', person.reg_no ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [staff, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setEditing(blankStaff());
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const doctorCount = staff.filter(
    (person) => person.is_active && person.role === 'doctor',
  ).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, role, phone"
          className="w-full sm:w-72"
          aria-label="Search staff"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {staff.length} &middot; {doctorCount} doctors
        </span>
        <span className="ml-auto flex items-center gap-4">
          <KbdHint keys="/">search</KbdHint>
          <KbdHint keys="N">new</KbdHint>
        </span>
        <Button onClick={() => setEditing(blankStaff())}>
          <PlusIcon data-icon="inline-start" />
          New staff
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Role</TableHead>
              <TableHead className="w-40">Department</TableHead>
              <TableHead className="w-36">Phone</TableHead>
              <TableHead className="w-36">Reg. no</TableHead>
              <TableHead className="w-28 text-right">Fee &#8377;</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-40 text-right">Actions</TableHead>
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
                        : `Nothing matches \u201c${query}\u201d`
                    }
                    description={
                      staff.length === 0
                        ? 'Add the doctors first \u2014 their consultation fee is what seeds the charge on every new visit.'
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((person) => (
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
                      {person.user_id ? (
                        // Someone who can actually sign in. Worth seeing at a
                        // glance: deactivating them does not revoke the login.
                        <KeyRoundIcon
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label="Has a login"
                        />
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="secondary">{ROLE_LABEL[person.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{departmentName(person.department_id)}</TableCell>
                  <TableCell className="font-mono text-xs">{person.phone ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{person.reg_no ?? '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {chargesConsultationFee(person.role) ? formatAmount(person.consultation_fee) : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={person.is_active ? 'success' : 'outline'}>
                      {person.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setEditing(person)}>
                        <PencilIcon data-icon="inline-start" />
                        Edit
                      </Button>
                      {!person.user_id && person.is_active ? (
                        <Button size="xs" variant="ghost" onClick={() => setInviting(person)}>
                          <MailPlusIcon data-icon="inline-start" />
                          Invite
                        </Button>
                      ) : null}
                      {person.is_active ? (
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
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <StaffDialog
          key={editing.id}
          person={editing}
          isNew={!staff.some((row) => row.id === editing.id)}
          departments={departments}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {inviting ? (
        <InviteDialog key={inviting.id} person={inviting} onClose={() => setInviting(null)} />
      ) : null}

      {deactivating ? (
        <DeactivateDialog
          key={deactivating.id}
          person={deactivating}
          onClose={() => setDeactivating(null)}
        />
      ) : null}
    </>
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
  departments,
  onClose,
}: {
  person: StaffRow;
  isNew: boolean;
  departments: DepartmentOption[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveStaff, IDLE);
  const [role, setRole] = useState<AppRole>(person.role);
  const [departmentId, setDepartmentId] = useState<string>(person.department_id ?? NO_DEPARTMENT);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const isDoctor = chargesConsultationFee(role);

  // An inactive department should not be offered for new assignments, but a
  // person already sitting in one keeps showing it -- otherwise editing their
  // phone number would silently move them out of it.
  const options = departments.filter(
    (department) => department.is_active || department.id === person.department_id,
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New staff record' : person.full_name}</DialogTitle>
          <DialogDescription>
            {person.user_id
              ? 'This person has a login. Changing the role here does not change what their sign-in can do.'
              : 'A staff record does not create a login. Logins are issued separately.'}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={person.id} />
          {/* The Select cannot post an empty value, so the real one is posted
              from here and the token stays in the UI. */}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="staff-role" error={fieldError(state, 'role')} required>
              <Select
                name="role"
                value={role}
                onValueChange={(value) => setRole(value as AppRole)}
              >
                <SelectTrigger id="staff-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ROLE_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Department"
              htmlFor="staff-department"
              error={fieldError(state, 'department_id')}
            >
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="staff-department" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                  {options.map((department) => (
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

          {/* Only doctors bill a consultation. The field is hidden rather than
              disabled, and the schema forces the value to 0 for every other
              role, so a fee cannot survive a role change. */}
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

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_active" defaultChecked={person.is_active} />
            Active
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving...">
              {isNew ? 'Create staff record' : 'Save changes'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ person, onClose }: { person: StaffRow; onClose: () => void }) {
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
            {person.user_id
              ? ' Their login is not revoked -- remove the membership for that.'
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

/**
 * Issue a login to someone who already has a staff record.
 *
 * The role selector defaults to the person's job but is a separate decision --
 * it sets what their sign-in may DO, which is not the same question as what
 * they are called (CLAUDE.md 5). The wording says so, because getting these two
 * confused is how a nurse ends up able to void invoices.
 */
function InviteDialog({ person, onClose }: { person: StaffRow; onClose: () => void }) {
  const [state, action] = useActionState(inviteStaff, IDLE);
  const [role, setRole] = useState<AppRole>(
    person.role === 'super_admin' ? 'admin' : person.role,
  );

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite {person.full_name}</DialogTitle>
          <DialogDescription>
            They get an email inviting them to set a password. If this address already has
            an account, it is added to this hospital instead and no email is sent.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="staff_id" value={person.id} />
          <input type="hidden" name="full_name" value={person.full_name} />

          <FormMessage state={state} />

          <Field label="Email" htmlFor="invite-email" error={fieldError(state, 'email')} required>
            <Input
              id="invite-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="doctor@hospital.in"
              aria-invalid={fieldError(state, 'email') !== undefined}
              required
              autoFocus
            />
          </Field>

          <Field
            label="This login may act as"
            htmlFor="invite-role"
            error={fieldError(state, 'role')}
            hint="Their access, not their job title. Change it later by editing their membership."
            required
          >
            <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="role" value={role} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Inviting...">Send invitation</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

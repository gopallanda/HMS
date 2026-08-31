'use client';

import { LockIcon, PencilIcon, PlusIcon, ShieldIcon, UserXIcon } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { deleteRole, saveRole } from './actions';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldError, IDLE } from '@/lib/action-state';
import { cn } from '@/lib/cn';
import {
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  type Permission,
} from '@/lib/rbac/permissions';

export type RoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  can_login: boolean;
  permissions: string[];
  staff_count: number;
};

function blankRole(): RoleRow {
  return {
    id: crypto.randomUUID(),
    code: '',
    name: '',
    description: null,
    is_system: false,
    can_login: true,
    permissions: [],
    staff_count: 0,
  };
}

export function RolesTable({ roles }: { roles: RoleRow[] }) {
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs text-muted-foreground">
          {roles.length} roles &middot; {roles.filter((role) => !role.can_login).length} that do not
          sign in
        </span>
        <Button className="ml-auto" onClick={() => setEditing(blankRole())}>
          <PlusIcon data-icon="inline-start" />
          New role
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead className="w-36">Code</TableHead>
              <TableHead className="w-28 text-right">People</TableHead>
              <TableHead className="w-28 text-right">Permissions</TableHead>
              <TableHead className="w-32">Signs in</TableHead>
              <TableHead className="w-36 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <EmptyState compact icon={ShieldIcon} title="No roles yet" />
                </TableCell>
              </TableRow>
            ) : (
              roles.map((role) => (
                <TableRow key={role.id} className="even:bg-muted/25">
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {role.name}
                      {role.is_system ? (
                        <LockIcon
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label="Built in"
                        />
                      ) : null}
                    </span>
                    {role.description ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {role.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {role.code}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{role.staff_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {role.permissions.length}
                  </TableCell>
                  <TableCell>
                    {role.can_login ? (
                      <Badge variant="secondary">Yes</Badge>
                    ) : (
                      <Badge variant="outline">
                        <UserXIcon data-icon="inline-start" />
                        No login
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setEditing(role)}>
                        <PencilIcon data-icon="inline-start" />
                        Edit
                      </Button>
                      {role.is_system ? null : (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDeleting(role)}
                        >
                          Delete
                        </Button>
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
        <RoleDialog
          key={editing.id}
          role={editing}
          isNew={!roles.some((row) => row.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteRoleDialog key={deleting.id} role={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}

function RoleDialog({
  role,
  isNew,
  onClose,
}: {
  role: RoleRow;
  isNew: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveRole, IDLE);
  const [held, setHeld] = useState<Set<string>>(() => new Set(role.permissions));
  const [canLogin, setCanLogin] = useState(role.can_login);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const toggle = (permission: Permission, on: boolean) => {
    setHeld((previous) => {
      const next = new Set(previous);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });
  };

  const toggleGroup = (permissions: readonly Permission[], on: boolean) => {
    setHeld((previous) => {
      const next = new Set(previous);
      for (const permission of permissions) {
        if (on) next.add(permission);
        else next.delete(permission);
      }
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New role' : role.name}</DialogTitle>
          <DialogDescription>
            {role.is_system
              ? 'A built-in role. Rename it and change what it may do; its code is fixed and it cannot be deleted.'
              : 'What this role may open. Changes take effect the next time somebody holding it signs in -- there is nothing to deploy.'}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={role.id} />
          <input type="hidden" name="is_system" value={role.is_system ? 'true' : 'false'} />

          <FormMessage state={state} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="role-name" error={fieldError(state, 'name')} required>
              <Input
                id="role-name"
                name="name"
                defaultValue={role.name}
                maxLength={60}
                required
                autoFocus
                aria-invalid={fieldError(state, 'name') !== undefined}
              />
            </Field>

            {role.is_system ? (
              <Field label="Code" htmlFor="role-code" hint="Built in. Cannot be changed.">
                <Input id="role-code" value={role.code} readOnly disabled className="font-mono" />
              </Field>
            ) : (
              <Field
                label="Code"
                htmlFor="role-code"
                error={fieldError(state, 'code')}
                hint="Lowercase, no spaces. Used in reports and never shown to patients."
                required
              >
                <Input
                  id="role-code"
                  name="code"
                  defaultValue={role.code}
                  placeholder="ward_sister"
                  maxLength={39}
                  required
                  className="font-mono"
                  aria-invalid={fieldError(state, 'code') !== undefined}
                />
              </Field>
            )}
          </div>

          <Field
            label="Description"
            htmlFor="role-description"
            error={fieldError(state, 'description')}
          >
            <Textarea
              id="role-description"
              name="description"
              defaultValue={role.description ?? ''}
              rows={2}
              maxLength={200}
            />
          </Field>

          {/* The whole point of block 1: some roles never touch the software.
              Saying so here is what hides the credentials section on the staff
              form and makes the provisioning action refuse. */}
          <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-3 text-sm">
            <Checkbox
              name="can_login"
              checked={canLogin}
              onCheckedChange={(value) => setCanLogin(value === true)}
              className="mt-0.5"
            />
            <span className="grid gap-0.5">
              <span className="font-medium">This role signs in to the software</span>
              <span className="text-xs text-muted-foreground">
                Leave this off for roles like Cleaner or Security. They still get a staff record and
                a roster; they just never get credentials.
              </span>
            </span>
          </label>

          <fieldset
            className={cn('grid gap-4', !canLogin && 'opacity-50')}
            disabled={!canLogin}
            aria-describedby={canLogin ? undefined : 'role-no-login-note'}
          >
            <legend className="sr-only">Permissions</legend>

            {canLogin ? null : (
              <p id="role-no-login-note" className="text-xs text-muted-foreground">
                A role that does not sign in holds no permissions.
              </p>
            )}

            {PERMISSION_GROUPS.map((group) => {
              const all = group.permissions.every((permission) => held.has(permission));
              return (
                <div key={group.key} className="grid gap-2 rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid gap-0.5">
                      <span className="text-sm font-medium">{group.label}</span>
                      <span className="text-xs text-muted-foreground">{group.description}</span>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => toggleGroup(group.permissions, !all)}
                    >
                      {all ? 'None' : 'All'}
                    </Button>
                  </div>

                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {group.permissions.map((permission) => (
                      <label key={permission} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={held.has(permission)}
                          onCheckedChange={(value) => toggle(permission, value === true)}
                          className="mt-0.5"
                        />
                        <span className="grid gap-0.5 leading-tight">
                          <span>{PERMISSION_LABEL[permission]}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {permission}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>

          {/* Checkboxes inside a disabled fieldset post nothing, and Radix
              checkboxes post nothing regardless -- so the real values go here,
              from the one piece of state the dialog keeps. */}
          {canLogin
            ? Array.from(held).map((permission) => (
                <input key={permission} type="hidden" name="permissions" value={permission} />
              ))
            : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving...">
              {isNew ? 'Create role' : 'Save changes'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const [state, action] = useActionState(deleteRole, IDLE);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = normalise(typed) === normalise(role.name);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {role.name}?</DialogTitle>
          <DialogDescription>
            {role.staff_count > 0
              ? `${role.staff_count} active staff still hold this role. Move them to another role first -- this will be refused.`
              : 'The role stops being offered on the staff form. Nothing that already happened changes.'}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={role.id} />

          <FormMessage state={state} />

          <Field
            label={`Type "${role.name}" to confirm`}
            htmlFor="confirm-role"
            error={fieldError(state, 'confirm')}
          >
            <Input
              id="confirm-role"
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
            <SubmitButton size="sm" variant="destructive" disabled={!matches} pendingLabel="Working...">
              Delete role
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

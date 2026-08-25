'use client';

import { PencilIcon, PlusIcon } from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { saveDepartment, setDepartmentActive } from './actions';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldError, IDLE, type ActionState } from '@/lib/action-state';

export type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

function blankDepartment(): DepartmentRow {
  // Minted here, not in Postgres: a resubmitted form then updates the row it
  // already created instead of adding a second one (CLAUDE.md 7).
  return { id: crypto.randomUUID(), name: '', code: '', is_active: true };
}

export function DepartmentsTable({ departments }: { departments: DepartmentRow[] }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [deactivating, setDeactivating] = useState<DepartmentRow | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return departments;
    return departments.filter(
      (department) =>
        department.name.toLowerCase().includes(needle) ||
        department.code.toLowerCase().includes(needle),
    );
  }, [departments, query]);

  // Keyboard first (CLAUDE.md 7). Admin screens are not the hot path that front
  // desk and billing are, but the shortcuts should mean the same thing
  // everywhere, so they are established here.
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
        setEditing(blankDepartment());
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeCount = departments.filter((department) => department.is_active).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or code"
          className="h-8 w-56"
          aria-label="Search departments"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {departments.length} &middot; {activeCount} active
        </span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          <kbd className="rounded border px-1">/</kbd> search
          <span className="mx-1">&middot;</span>
          <kbd className="rounded border px-1">N</kbd> new
        </span>
        <Button size="sm" onClick={() => setEditing(blankDepartment())}>
          <PlusIcon data-icon="inline-start" />
          New department
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-40 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                  {departments.length === 0
                    ? 'No departments yet. Create the ones patients are registered against.'
                    : `Nothing matches "${query}".`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((department) => (
                <TableRow key={department.id} className={department.is_active ? undefined : 'opacity-60'}>
                  <TableCell className="font-mono text-xs">{department.code}</TableCell>
                  <TableCell className="font-medium">{department.name}</TableCell>
                  <TableCell>
                    <Badge variant={department.is_active ? 'secondary' : 'outline'}>
                      {department.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setEditing(department)}>
                        <PencilIcon data-icon="inline-start" />
                        Edit
                      </Button>
                      {department.is_active ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDeactivating(department)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <ReactivateButton department={department} />
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
        <DepartmentDialog
          key={editing.id}
          department={editing}
          isNew={!departments.some((row) => row.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deactivating ? (
        <DeactivateDialog
          key={deactivating.id}
          department={deactivating}
          onClose={() => setDeactivating(null)}
        />
      ) : null}
    </>
  );
}

/** Reactivating is not destructive, so it is a single click with no dialog. */
function ReactivateButton({ department }: { department: DepartmentRow }) {
  const [state, action] = useActionState(setDepartmentActive, IDLE);
  useToastOnResult(state);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={department.id} />
      <input type="hidden" name="is_active" value="true" />
      <SubmitButton size="xs" variant="ghost">
        Reactivate
      </SubmitButton>
    </form>
  );
}

function DepartmentDialog({
  department,
  isNew,
  onClose,
}: {
  department: DepartmentRow;
  isNew: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveDepartment, IDLE);

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
          <DialogTitle>{isNew ? 'New department' : department.name}</DialogTitle>
          <DialogDescription>
            The code appears on reports and is unique within this hospital.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-3">
          <input type="hidden" name="id" value={department.id} />

          <FormMessage state={state} />

          <Field label="Name" htmlFor="department-name" error={fieldError(state, 'name')} required>
            <Input
              id="department-name"
              name="name"
              defaultValue={department.name}
              maxLength={80}
              required
              autoFocus
              aria-invalid={fieldError(state, 'name') !== undefined}
            />
          </Field>

          <Field
            label="Code"
            htmlFor="department-code"
            error={fieldError(state, 'code')}
            hint="Letters, digits and underscores. Stored in upper case."
            required
          >
            <Input
              id="department-code"
              name="code"
              defaultValue={department.code}
              maxLength={12}
              required
              className="font-mono uppercase"
              spellCheck={false}
              aria-invalid={fieldError(state, 'code') !== undefined}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_active" defaultChecked={department.is_active} />
            Active
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Saving...">
              {isNew ? 'Create department' : 'Save changes'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  department,
  onClose,
}: {
  department: DepartmentRow;
  onClose: () => void;
}) {
  const [state, action] = useActionState(setDepartmentActive, IDLE);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const matches = typed.trim().toUpperCase() === department.code.toUpperCase();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate {department.name}?</DialogTitle>
          <DialogDescription>
            Nothing is deleted. The department stops appearing in registration and staff forms, and
            existing records keep pointing at it.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-3">
          <input type="hidden" name="id" value={department.id} />
          <input type="hidden" name="is_active" value="false" />

          <FormMessage state={state} />

          <Field
            label={`Type ${department.code} to confirm`}
            htmlFor="confirm-code"
            error={fieldError(state, 'confirm')}
          >
            <Input
              id="confirm-code"
              name="confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="font-mono uppercase"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="sm" variant="destructive" disabled={!matches} pendingLabel="Working...">
              Deactivate
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Row-level actions have no dialog to report into, so they toast instead. */
function useToastOnResult(state: ActionState) {
  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
    if (state.status === 'error') toast.error(state.message);
  }, [state]);
}

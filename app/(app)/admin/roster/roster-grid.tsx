'use client';

import { ChevronLeftIcon, ChevronRightIcon, UsersIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { clearShift, saveShift } from './actions';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE } from '@/lib/action-state';
import { cn } from '@/lib/cn';
import {
  NON_WORKING_STATUSES,
  SHIFT_STATUSES,
  SHIFT_STATUS_LABEL,
  type ShiftStatusValue,
} from '@/lib/schemas/shift';

export type RosterPerson = {
  id: string;
  full_name: string;
  employee_code: string | null;
  role_name: string;
  department_id: string | null;
};

export type RosterDepartment = { id: string; name: string };

export type ShiftCell = {
  id: string;
  staff_id: string;
  work_date: string;
  status: ShiftStatusValue;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  notes: string | null;
};

/** One letter per state, so a 31-column grid stays readable at a glance. */
const STATUS_MARK: Record<ShiftStatusValue, string> = {
  scheduled: 'S',
  present: 'P',
  absent: 'A',
  day_off: 'O',
  leave: 'L',
};

const STATUS_STYLE: Record<ShiftStatusValue, string> = {
  scheduled: 'bg-muted text-muted-foreground',
  present: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  absent: 'bg-destructive/15 text-destructive',
  day_off: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  leave: 'bg-amber-500/15 text-amber-700 dark:text-amber-500',
};

const ALL_DEPARTMENTS = '__all__';

function addMonths(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayOfWeek(month: string, day: number): number {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1, day)).getUTCDay();
}

export function RosterGrid({
  month,
  days,
  people,
  departments,
  departmentFilter,
  shifts,
  canWrite,
}: {
  month: string;
  days: number;
  people: RosterPerson[];
  departments: RosterDepartment[];
  departmentFilter: string | null;
  shifts: ShiftCell[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [editing, setEditing] = useState<{ person: RosterPerson; date: string } | null>(null);

  const byCell = useMemo(() => {
    const map = new Map<string, ShiftCell>();
    for (const shift of shifts) map.set(`${shift.staff_id}:${shift.work_date}`, shift);
    return map;
  }, [shifts]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const shift of shifts) {
      if (shift.hours === null) continue;
      map.set(shift.staff_id, (map.get(shift.staff_id) ?? 0) + Number(shift.hours));
    }
    return map;
  }, [shifts]);

  const go = (next: { month?: string; department?: string | null }) => {
    const search = new URLSearchParams(params.toString());
    if (next.month) search.set('month', next.month);
    if (next.department === null) search.delete('department');
    else if (next.department !== undefined) search.set('department', next.department);
    router.push(`?${search.toString()}`);
  };

  const dayNumbers = Array.from({ length: days }, (_, index) => index + 1);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous month"
            onClick={() => go({ month: addMonths(month, -1) })}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">{monthLabel(month)}</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next month"
            onClick={() => go({ month: addMonths(month, 1) })}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        {/* Filtering by department is what makes this page usable: the manager
            opens Housekeeping and fills in the cleaners, rather than scrolling
            past forty clinicians to find them. */}
        <Select
          value={departmentFilter ?? ALL_DEPARTMENTS}
          onValueChange={(value) =>
            go({ department: value === ALL_DEPARTMENTS ? null : value })
          }
        >
          <SelectTrigger className="w-56" aria-label="Filter by department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_DEPARTMENTS}>Every department</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {people.length} staff &middot; {shifts.length} shifts recorded
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {SHIFT_STATUSES.map((status) => (
            <span key={status} className="flex items-center gap-1">
              <span
                className={cn(
                  'grid size-4 place-items-center rounded font-mono text-[10px] font-semibold',
                  STATUS_STYLE[status],
                )}
              >
                {STATUS_MARK[status]}
              </span>
              {SHIFT_STATUS_LABEL[status]}
            </span>
          ))}
        </span>
      </div>

      {people.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card">
          <EmptyState
            icon={UsersIcon}
            title="Nobody to roster"
            description={
              departmentFilter
                ? 'No active staff sit in that department. Assign somebody to it on the staff screen.'
                : 'Add staff records first. Roles that never sign in still belong here.'
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Staff
                </th>
                {dayNumbers.map((day) => {
                  const weekday = dayOfWeek(month, day);
                  return (
                    <th
                      key={day}
                      className={cn(
                        'w-8 px-0 py-2 text-center text-[11px] font-medium text-muted-foreground',
                        weekday === 0 && 'bg-muted/40',
                      )}
                    >
                      {day}
                    </th>
                  );
                })}
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className="even:bg-muted/25">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-inherit px-3 py-1.5 text-left font-normal"
                  >
                    <span className="block max-w-56 truncate font-medium">{person.full_name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {person.role_name}
                      {person.employee_code ? ` · ${person.employee_code}` : ''}
                    </span>
                  </th>

                  {dayNumbers.map((day) => {
                    const date = `${month}-${String(day).padStart(2, '0')}`;
                    const shift = byCell.get(`${person.id}:${date}`);
                    const weekday = dayOfWeek(month, day);

                    return (
                      <td
                        key={day}
                        className={cn('p-0.5 text-center', weekday === 0 && 'bg-muted/40')}
                      >
                        <button
                          type="button"
                          disabled={!canWrite}
                          onClick={() => setEditing({ person, date })}
                          title={
                            shift
                              ? `${SHIFT_STATUS_LABEL[shift.status]}${shift.hours ? ` · ${shift.hours}h` : ''}`
                              : 'Nothing recorded'
                          }
                          aria-label={`${person.full_name}, ${date}: ${
                            shift ? SHIFT_STATUS_LABEL[shift.status] : 'nothing recorded'
                          }`}
                          className={cn(
                            'grid size-7 place-items-center rounded font-mono text-[11px] font-semibold transition-colors',
                            shift
                              ? STATUS_STYLE[shift.status]
                              : 'text-muted-foreground/40 hover:bg-muted',
                            canWrite ? 'cursor-pointer' : 'cursor-default',
                          )}
                        >
                          {shift ? STATUS_MARK[shift.status] : '·'}
                        </button>
                      </td>
                    );
                  })}

                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {(totals.get(person.id) ?? 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ShiftDialog
          key={`${editing.person.id}:${editing.date}`}
          person={editing.person}
          date={editing.date}
          shift={byCell.get(`${editing.person.id}:${editing.date}`) ?? null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function ShiftDialog({
  person,
  date,
  shift,
  onClose,
}: {
  person: RosterPerson;
  date: string;
  shift: ShiftCell | null;
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveShift, IDLE);
  const [clearState, clearAction] = useActionState(clearShift, IDLE);
  const [status, setStatus] = useState<ShiftStatusValue>(shift?.status ?? 'present');

  useEffect(() => {
    if (state.status === 'success' || clearState.status === 'success') {
      toast.success(state.status === 'success' ? state.message : clearState.status === 'success' ? clearState.message : '');
      onClose();
    }
  }, [state, clearState, onClose]);

  const working = !NON_WORKING_STATUSES.includes(status);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{person.full_name}</DialogTitle>
          <DialogDescription>
            {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
            {' · '}
            {person.role_name}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={shift?.id ?? crypto.randomUUID()} />
          <input type="hidden" name="staff_id" value={person.id} />
          <input type="hidden" name="work_date" value={date} />
          <input type="hidden" name="status" value={status} />

          <FormMessage state={state} />

          <Field label="Status" htmlFor="shift-status" error={fieldError(state, 'status')} required>
            <Select value={status} onValueChange={(value) => setStatus(value as ShiftStatusValue)}>
              <SelectTrigger id="shift-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_STATUSES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {SHIFT_STATUS_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Times and hours disappear for a day off or a leave day rather than
              being greyed out: they do not apply, and the database clears them
              anyway. */}
          {working ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="From" htmlFor="shift-start" error={fieldError(state, 'start_time')}>
                  <Input
                    id="shift-start"
                    name="start_time"
                    type="time"
                    defaultValue={shift?.start_time?.slice(0, 5) ?? ''}
                  />
                </Field>
                <Field label="To" htmlFor="shift-end" error={fieldError(state, 'end_time')}>
                  <Input
                    id="shift-end"
                    name="end_time"
                    type="time"
                    defaultValue={shift?.end_time?.slice(0, 5) ?? ''}
                  />
                </Field>
                <Field
                  label="Hours"
                  htmlFor="shift-hours"
                  error={fieldError(state, 'hours')}
                  hint="Leave blank to compute."
                >
                  <Input
                    id="shift-hours"
                    name="hours"
                    inputMode="decimal"
                    defaultValue={shift?.hours != null ? String(shift.hours) : ''}
                    placeholder="8"
                    className="text-right tabular-nums"
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Hours are stored, not recalculated later: if the shift ran 08:00 to 16:00 with an
                unpaid break, type 7.5 and that is what payroll sees.
              </p>
            </>
          ) : null}

          <Field label="Notes" htmlFor="shift-notes" error={fieldError(state, 'notes')}>
            <Textarea
              id="shift-notes"
              name="notes"
              defaultValue={shift?.notes ?? ''}
              rows={2}
              maxLength={500}
              placeholder="Covered ward 2"
            />
          </Field>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving...">Save shift</SubmitButton>
          </DialogFooter>
        </form>

        {shift ? (
          <form action={clearAction} className="border-t border-border/60 pt-3">
            <input type="hidden" name="staff_id" value={person.id} />
            <input type="hidden" name="work_date" value={date} />
            <FormMessage state={clearState} />
            <SubmitButton size="sm" variant="ghost" className="text-destructive" pendingLabel="Clearing...">
              Clear this day
            </SubmitButton>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

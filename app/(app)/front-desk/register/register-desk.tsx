'use client';

import {
  SearchIcon,
  TicketIcon,
  UserRoundPlusIcon,
  UserRoundSearchIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  registerPatientAction,
  startVisitAction,
  type RegisterPatientState,
  type StartVisitState,
} from './actions';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { FormMessage, Notice } from '@/components/shared/form-message';
import { Kbd, KbdHint } from '@/components/shared/kbd';
import {
  MIN_QUERY,
  PatientResultRow,
  usePatientSearch,
} from '@/components/shared/patient-search';
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
import { ageGender, GENDERS, GENDER_LABEL, type Gender } from '@/lib/patients';
import type { PatientSearchResult } from '@/lib/rpc/patients';
import { formatMoney } from '@/lib/utils/money';
import { VISIT_TYPES_AT_DESK, VISIT_TYPE_LABEL, type VisitType } from '@/lib/visits';

export type DoctorOption = {
  id: string;
  full_name: string;
  department_id: string | null;
  consultation_fee: number;
};

export type DepartmentOption = { id: string; name: string };

/** Radix Select cannot hold an empty value, so "no department" needs a token. */
const NO_DEPARTMENT = '__none__';

/**
 * A patient, as this screen needs it -- from the search, fresh from a register,
 * or handed in by the patient record's "New visit" button (?patient=<id>).
 */
export type DeskPatient = {
  id: string;
  mrn: string;
  full_name: string;
  dob: string;
  gender: Gender;
  phone: string | null;
};

function fromSearch(row: PatientSearchResult): DeskPatient {
  return {
    id: row.id,
    mrn: row.mrn,
    full_name: row.full_name,
    dob: row.dob,
    gender: row.gender,
    phone: row.phone,
  };
}

/**
 * What the operator typed, split into the field it most likely belongs in.
 * Somebody who typed a phone number and found nothing should not have to type
 * it again in the register form.
 */
function prefillFrom(query: string): { full_name: string; phone: string } {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, '');

  return digits.length >= 6
    ? { full_name: '', phone: trimmed }
    : { full_name: trimmed, phone: '' };
}

export function RegisterDesk({
  doctors,
  departments,
  initialPatient = null,
}: {
  doctors: DoctorOption[];
  departments: DepartmentOption[];
  /**
   * Resolved from ?patient=<id> on the server: somebody pressed "New visit" on
   * a patient record, so the visit dialog opens on that patient instead of
   * asking them to search for a person they were already looking at.
   */
  initialPatient?: DeskPatient | null;
}) {
  const [query, setQuery] = useState('');
  const [registering, setRegistering] = useState<{ full_name: string; phone: string } | null>(null);
  const [visitFor, setVisitFor] = useState<DeskPatient | null>(initialPatient);
  const [lastVisit, setLastVisit] = useState<{
    token_no: number;
    visit_no: string;
    patient: string;
  } | null>(null);

  const searchInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isFetching, error, active, debounced } = usePatientSearch(query);
  const results = useMemo(() => data ?? [], [data]);

  const dialogOpen = registering !== null || visitFor !== null;

  const [highlight, setHighlight] = useState(0);
  const [highlightFor, setHighlightFor] = useState('');

  if (highlightFor !== debounced) {
    // Adjusted during render rather than in an effect: a new set of results
    // starts at the top, and React re-renders before anything reaches the DOM.
    setHighlightFor(debounced);
    setHighlight(0);
  }

  /** Highlighted row, clamped -- the list can shrink under a held arrow key. */
  const cursor = results.length === 0 ? -1 : Math.min(highlight, results.length - 1);

  // Keep the highlighted row visible when the list is longer than the panel.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const openRegister = useCallback(() => {
    setRegistering(prefillFrom(query));
  }, [query]);

  const backToSearch = useCallback(() => {
    setQuery('');
    // The next patient is already at the counter: the caret goes back where
    // the work starts, without anyone reaching for the mouse.
    searchInput.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dialogOpen) return;

      // F2 is not a typing key, so it works from inside the search box too --
      // which is exactly where the operator's hands already are.
      if (event.key === 'F2') {
        event.preventDefault();
        openRegister();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, openRegister]);

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = cursor >= 0 ? results[cursor] : undefined;
      if (picked) {
        // Enter on a match goes straight to the visit -- the common case, and
        // the reason this screen is search-first (CLAUDE.md 3.3).
        setVisitFor(fromSearch(picked));
      } else if (query.trim().length >= MIN_QUERY) {
        openRegister();
      }
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      setQuery('');
    }
  }

  return (
    <>
      {/* The command bar. This one control is the whole screen: the day starts
          with a phone number typed into it, and everything else on the page is
          a consequence of what it returns (CLAUDE.md 3.3). It is sized and
          weighted to say so, rather than sitting in a toolbar as one more
          control among several. */}
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute inset-y-0 left-4 my-auto size-4.5 text-muted-foreground" />
            <Input
              ref={searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Phone, name or MRN"
              className="h-12 rounded-xl border-transparent bg-muted/60 pr-12 pl-12 text-base shadow-none transition-all focus-visible:border-primary focus-visible:bg-background focus-visible:shadow-md md:h-12 md:text-base"
              aria-label="Search patients"
              aria-controls="patient-results"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 hidden items-center lg:flex">
              <Kbd always>/</Kbd>
            </span>
          </div>

          <Button
            variant="outline"
            onClick={openRegister}
            className="h-12 shrink-0 rounded-xl md:h-12"
          >
            <UserRoundPlusIcon data-icon="inline-start" />
            Register new patient
            <Kbd className="ml-1.5">F2</Kbd>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {!active
              ? `Type ${MIN_QUERY} characters or more`
              : isFetching
                ? 'Searching...'
                : `${results.length} match${results.length === 1 ? '' : 'es'}`}
          </span>

          <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <KbdHint keys={['\u2191', '\u2193']}>move</KbdHint>
            <KbdHint keys="Enter">new visit</KbdHint>
            <KbdHint keys="F2">register</KbdHint>
            <KbdHint keys="Esc">clear</KbdHint>
          </span>
        </div>
      </div>

      {lastVisit ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-success/10 px-4 py-3 text-sm text-success dark:bg-success/15">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-base font-bold text-background tabular-nums">
            {lastVisit.token_no}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold">
              <TicketIcon className="size-4" />
              Token {lastVisit.token_no} issued
            </span>
            <span className="block truncate text-xs opacity-90">
              {lastVisit.visit_no} &middot; {lastVisit.patient}
            </span>
          </span>
          <Link
            href="/front-desk/queue"
            className="ml-auto shrink-0 text-xs font-medium underline underline-offset-4 hover:no-underline"
          >
            Open the queue
          </Link>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          Search failed: {error.message}
        </p>
      ) : null}

      <div
        ref={listRef}
        id="patient-results"
        role="listbox"
        aria-label="Matching patients"
        className="custom-scrollbar max-h-[28rem] overflow-y-auto rounded-xl border border-border/60 bg-card shadow-sm"
      >
        {!active ? (
          <EmptyState
            icon={UserRoundSearchIcon}
            title="Search for a patient, or press F2 to register"
            description="Phone number, name or MRN. Registering a patient who is already on file splits their history in two."
          />
        ) : results.length === 0 && !isFetching ? (
          <EmptyState
            icon={UserRoundPlusIcon}
            title={`Nobody matches \u201c${query.trim()}\u201d`}
            description="Press Enter or F2 to register a new patient. What you typed is carried over."
          />
        ) : (
          results.map((patient, index) => (
            <PatientResultRow
              key={patient.id}
              patient={patient}
              index={index}
              selected={index === cursor}
              onHover={() => setHighlight(index)}
              onPick={() => setVisitFor(fromSearch(patient))}
            />
          ))
        )}
      </div>

      {registering ? (
        <RegisterDialog
          prefill={registering}
          onClose={() => setRegistering(null)}
          onRegistered={(patient) => {
            setRegistering(null);
            // Straight on to the visit: registering somebody who then walks
            // away without a token is not a completed job.
            setVisitFor(patient);
          }}
          onUseExisting={(patient) => {
            setRegistering(null);
            setVisitFor(patient);
          }}
        />
      ) : null}

      {visitFor ? (
        <VisitDialog
          patient={visitFor}
          doctors={doctors}
          departments={departments}
          onClose={() => setVisitFor(null)}
          onCreated={(visit) => {
            setLastVisit({ ...visit, patient: visitFor.full_name });
            setVisitFor(null);
            backToSearch();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The fallback path, never the default one (CLAUDE.md 3.3).
 *
 * It carries over whatever was typed into the search box, and it refuses to
 * silently create a second patient on a phone number that is already on file --
 * register_patient raises, this shows who is already there, and a human
 * decides.
 */
function RegisterDialog({
  prefill,
  onClose,
  onRegistered,
  onUseExisting,
}: {
  prefill: { full_name: string; phone: string };
  onClose: () => void;
  onRegistered: (patient: DeskPatient) => void;
  onUseExisting: (patient: DeskPatient) => void;
}) {
  const initial: RegisterPatientState = IDLE;
  const [state, action] = useActionState(registerPatientAction, initial);

  // One id per dialog instance, generated in the browser: a form resubmitted
  // after a dropped connection writes the same patient, not a second one
  // (CLAUDE.md 7).
  const [id] = useState(() => crypto.randomUUID());
  const [gender, setGender] = useState<Gender>('female');
  const [phone, setPhone] = useState(prefill.phone);
  const [force, setForce] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success' && state.patient) {
      toast.success(state.message);
      onRegistered({ ...state.patient, gender });
    }
  }, [state, gender, onRegistered]);

  // Only asked for once the database has said the number is already in use.
  const digits = phone.replace(/\D/g, '');
  const duplicates = usePatientSearch(digits, state.duplicate === true);

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    // Submit from anywhere in the form, including from a closed dropdown.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Register a new patient</DialogTitle>
          <DialogDescription>
            The MRN is allocated by the database. Age is stored as a date of birth, so it stays
            correct next year.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={action} onKeyDown={onFormKeyDown} className="grid gap-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="gender" value={gender} />
          <input type="hidden" name="force_create" value={force ? 'true' : ''} />

          <FormMessage state={state} />

          {state.duplicate ? (
            <Notice>
              <p className="font-medium">Already registered on this number</p>
              <div className="mt-1.5 grid gap-0.5">
                {(duplicates.data ?? []).map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => onUseExisting(fromSearch(match))}
                    className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-background"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{match.mrn}</span>
                    <span className="min-w-0 flex-1 truncate">{match.full_name}</span>
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {ageGender(match.dob, match.gender)}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline">
                      use this one
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs opacity-80">
                A family sharing one mobile is normal. If this really is a different person,
                register anyway.
              </p>
            </Notice>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Patient name"
              htmlFor="patient-name"
              error={fieldError(state, 'full_name')}
              required
            >
              <Input
                id="patient-name"
                name="full_name"
                defaultValue={prefill.full_name}
                maxLength={120}
                required
                autoFocus
                autoComplete="off"
                aria-invalid={fieldError(state, 'full_name') !== undefined}
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="patient-phone"
              error={fieldError(state, 'phone')}
              hint="How this patient is found next time. Worth asking for."
            >
              <Input
                id="patient-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setForce(false);
                }}
                placeholder="+91 98450 11223"
                autoComplete="off"
                aria-invalid={fieldError(state, 'phone') !== undefined}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Date of birth"
              htmlFor="patient-dob"
              error={fieldError(state, 'dob')}
              className="sm:col-span-1"
            >
              <Input
                id="patient-dob"
                name="dob"
                type="date"
                aria-invalid={fieldError(state, 'dob') !== undefined}
              />
            </Field>

            <Field
              label="or age in years"
              htmlFor="patient-age"
              error={fieldError(state, 'age_years')}
              hint="Stored as an approximate date."
            >
              <Input
                id="patient-age"
                name="age_years"
                inputMode="numeric"
                maxLength={3}
                placeholder="42"
                autoComplete="off"
                aria-invalid={fieldError(state, 'age_years') !== undefined}
              />
            </Field>

            <Field label="Gender" htmlFor="patient-gender" error={fieldError(state, 'gender')} required>
              <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
                <SelectTrigger id="patient-gender" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {GENDER_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Address" htmlFor="patient-address" error={fieldError(state, 'address')}>
            <Textarea
              id="patient-address"
              name="address"
              rows={2}
              maxLength={300}
              autoComplete="off"
            />
          </Field>

          <DialogFooter className="items-center">
            <span className="mr-auto hidden items-center gap-4 sm:flex">
              <KbdHint keys={['Ctrl', 'Enter']} always>
                save
              </KbdHint>
              <KbdHint keys="Esc" always>
                close
              </KbdHint>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {state.duplicate && !force ? (
              <Button type="button" size="sm" variant="destructive" onClick={() => setForce(true)}>
                Different person - register anyway
              </Button>
            ) : (
              <SubmitButton size="sm" pendingLabel="Registering...">
                {force ? 'Register anyway' : 'Register and start visit'}
              </SubmitButton>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The visit is where the doctor, department and episode live (CLAUDE.md 4).
 * Creating one allocates the visit number and today's next token, and raises
 * the consultation charge from the doctor's own fee -- in one transaction.
 */
function VisitDialog({
  patient,
  doctors,
  departments,
  onClose,
  onCreated,
}: {
  patient: DeskPatient;
  doctors: DoctorOption[];
  departments: DepartmentOption[];
  onClose: () => void;
  onCreated: (visit: { token_no: number; visit_no: string }) => void;
}) {
  const initial: StartVisitState = IDLE;
  const [state, action] = useActionState(startVisitAction, initial);

  const [id] = useState(() => crypto.randomUUID());
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const [visitType, setVisitType] = useState<VisitType>('opd');
  const [departmentOverride, setDepartmentOverride] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const doctor = doctors.find((option) => option.id === doctorId);

  // Derived, not stored: the department follows the doctor until somebody
  // picks one, and after that it stays picked. Most OPD registrations never
  // touch it.
  const departmentId = departmentOverride ?? doctor?.department_id ?? NO_DEPARTMENT;

  useEffect(() => {
    if (state.status === 'success' && state.visit) {
      toast.success(`Token ${state.visit.token_no} - ${patient.full_name}`, {
        description: state.visit.visit_no,
      });
      onCreated(state.visit);
    }
  }, [state, patient.full_name, onCreated]);

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New visit</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
              <span className="font-medium text-foreground">{patient.full_name}</span>
              <span className="text-xs text-muted-foreground">
                {ageGender(patient.dob, patient.gender)}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{patient.mrn}</span>
              {patient.phone ? (
                <span className="font-mono text-xs text-muted-foreground">{patient.phone}</span>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={action} onKeyDown={onFormKeyDown} className="grid gap-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="patient_id" value={patient.id} />
          <input type="hidden" name="doctor_id" value={doctorId} />
          <input type="hidden" name="visit_type" value={visitType} />
          <input
            type="hidden"
            name="department_id"
            value={departmentId === NO_DEPARTMENT ? '' : departmentId}
          />

          <FormMessage state={state} />

          <Field label="Doctor" htmlFor="visit-doctor" error={fieldError(state, 'doctor_id')} required>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger id="visit-doctor" className="w-full" autoFocus>
                <SelectValue placeholder="Choose a doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Department"
              htmlFor="visit-department"
              error={fieldError(state, 'department_id')}
              hint={departmentOverride ? undefined : "Follows the doctor's department."}
            >
              <Select
                value={departmentId}
                onValueChange={setDepartmentOverride}
              >
                <SelectTrigger id="visit-department" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                  {departments.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Visit type" htmlFor="visit-type" error={fieldError(state, 'visit_type')}>
              <div
                id="visit-type"
                className="flex h-10 items-center gap-1 rounded-lg bg-muted p-1 md:h-8"
              >
                {VISIT_TYPES_AT_DESK.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={visitType === option}
                    onClick={() => setVisitType(option)}
                    className={cn(
                      'flex-1 rounded-md px-3 py-1 text-sm transition-all focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                      visitType === option
                        ? 'bg-background font-medium text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {VISIT_TYPE_LABEL[option]}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            {doctor && doctor.consultation_fee > 0 ? (
              <>
                A pending consultation charge of{' '}
                <strong className="font-semibold text-foreground tabular-nums">
                  {formatMoney(doctor.consultation_fee)}
                </strong>{' '}
                will be raised on this visit. Billing collects it.
              </>
            ) : (
              <>
                {doctor?.full_name ?? 'This doctor'} has no consultation fee on record, so no
                charge is raised. Set one in Staff if that is wrong.
              </>
            )}
          </p>

          <DialogFooter className="items-center">
            <span className="mr-auto hidden items-center gap-4 sm:flex">
              <KbdHint keys={['Ctrl', 'Enter']} always>
                start visit
              </KbdHint>
              <KbdHint keys="Esc" always>
                close
              </KbdHint>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Starting..." disabled={doctors.length === 0}>
              Start visit
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

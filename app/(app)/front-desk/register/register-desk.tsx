'use client';

import {
  BanknoteIcon,
  PencilIcon,
  PrinterIcon,
  SearchIcon,
  TicketIcon,
  UserRoundPlusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { registerAction, type RegisterState } from './actions';
import { Field, FieldSet } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { KbdHint } from '@/components/shared/kbd';
import { MIN_QUERY, usePatientSearch } from '@/components/shared/patient-search';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
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
import { PAYMENT_MODES, PAYMENT_MODE_LABEL, type PaymentMode } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { ageGender, GENDERS, GENDER_LABEL, type Gender } from '@/lib/patients';
import type { PatientSearchResult } from '@/lib/rpc/patients';
import { formatMoney } from '@/lib/utils/money';

/**
 * The register desk.
 *
 * ONE form, one RPC, one transaction (block 4.2). It used to be a search, then
 * a dialog that created a patient, then a second dialog that created a visit,
 * and a clerk could stop after any of them. Now nothing is written until
 * submit, and what is written is complete: patient, visit, token, invoice, and
 * either the payment or a recorded deferral.
 *
 * The layout rules are block 6, and they are worth stating because they apply
 * to every form after this one:
 *
 *   * <Field> reserves the hint/error line, so a validation message appearing
 *     under one control never moves its neighbour. That single change is most
 *     of what the screenshot in the brief was complaining about.
 *   * One 12-column grid, items-start, gap-x-6 gap-y-5. Every control the same
 *     height.
 *   * The search icon is positioned against the INPUT at left-3 with pl-10 on
 *     the input itself, never against a wrapper whose padding the input does
 *     not inherit.
 *   * Cancel is a ghost, "Register & collect" is the primary. Nothing on the
 *     happy path is styled destructive.
 */

export type DoctorOption = {
  id: string;
  full_name: string;
  department_id: string | null;
  consultation_fee: number;
  /** How many people are already waiting for them today. */
  waiting: number;
  /** Rostered today, or the hospital keeps no roster. See the page. */
  on_duty: boolean;
};

export type DepartmentOption = { id: string; name: string };

export type DeskPatient = {
  id: string;
  mrn: string;
  full_name: string;
  dob: string;
  gender: Gender;
  phone: string | null;
};

/** Radix Select cannot hold an empty value, so "no department" needs a token. */
const NO_DEPARTMENT = '__none__';

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

/** What was typed, split into the field it most likely belongs in. */
function prefillFrom(query: string): { full_name: string; phone: string } {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 6 ? { full_name: '', phone: trimmed } : { full_name: trimmed, phone: '' };
}

export function RegisterDesk({
  doctors,
  departments,
  initialPatient = null,
  canEditFee,
  canDefer,
}: {
  doctors: DoctorOption[];
  departments: DepartmentOption[];
  initialPatient?: DeskPatient | null;
  /** billing.collect. Without it the fee is shown but not editable. */
  canEditFee: boolean;
  /** billing.defer. Without it the "cannot pay now" link is not rendered. */
  canDefer: boolean;
}) {
  const [state, action] = useActionState<RegisterState, FormData>(registerAction, IDLE);

  /**
   * One generation of ids per registration. Regenerated only when the desk
   * starts the NEXT patient, so a resubmit after a dropped connection returns
   * the same patient, visit and invoice instead of a second set (CLAUDE.md 7).
   */
  const [ids, setIds] = useState(newIds);

  /**
   * The registration whose success panel has been dismissed (defect 2).
   *
   * useActionState owns `state`, and there is no way to clear it from here --
   * it only changes when the action runs again. So "Register next patient"
   * used to reset every local field, leave state.status on 'success', and
   * re-render the very same panel: the button looked dead because nothing it
   * touched was what decided which screen you were on.
   *
   * Keyed on the visit id rather than a boolean, so the NEXT registration's
   * panel appears on its own without anything having to remember to unset a
   * flag first.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  /**
   * Set while the form is coming back, so focus lands after it has mounted.
   *
   * A ref rather than state: nothing renders differently because of it, and a
   * setState in the effect that reads it would be a cascading render for no
   * visible reason.
   */
  const refocus = useRef(false);

  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<DeskPatient | null>(initialPatient);
  const [editingChosen, setEditingChosen] = useState(false);

  const [gender, setGender] = useState<Gender>('female');
  const [phone, setPhone] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [departmentPick, setDepartmentPick] = useState<string | null>(null);
  const [fee, setFee] = useState('');
  const [feeTouched, setFeeTouched] = useState(false);
  const [mode, setMode] = useState<PaymentMode | ''>('cash');
  const [deferring, setDeferring] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  const { data, isFetching, active } = usePatientSearch(query);
  const matches = useMemo(() => data ?? [], [data]);

  const doctor = doctors.find((option) => option.id === doctorId);
  const departmentId = departmentPick ?? doctor?.department_id ?? NO_DEPARTMENT;

  /**
   * Doctors, narrowed to the chosen department (block 4.2 step 3).
   *
   * Never narrowed to nothing: a department with no doctor assigned to it
   * would otherwise leave the desk unable to register anybody, which is a
   * worse answer than showing the whole list.
   */
  const visible = useMemo(() => {
    if (departmentPick === null || departmentPick === NO_DEPARTMENT) return doctors;
    const inDepartment = doctors.filter((option) => option.department_id === departmentPick);
    return inDepartment.length > 0 ? inDepartment : doctors;
  }, [doctors, departmentPick]);

  // The fee follows whichever doctor is selected until somebody types over it.
  const effectiveFee = feeTouched ? fee : doctor ? String(doctor.consultation_fee) : '';

  const result = state.status === 'success' ? state.result : undefined;
  const done = result && result.visit_id !== dismissed ? result : undefined;

  /**
   * The banner belongs to the registration that produced it. Once its panel is
   * dismissed the next patient starts on a clean form, not under a green
   * message about the last one.
   */
  const formState = result && result.visit_id === dismissed ? IDLE : state;

  useEffect(() => {
    if (done) {
      toast.success(`Token ${done.token_no} - ${done.patient_name}`, {
        description: `${done.mrn} · ${done.invoice_no}`,
      });
      // The clerk's hands stay on the keyboard: the next thing they will press
      // is "Register next patient", so that is what has focus.
      nextButton.current?.focus();
    }
  }, [done]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('[role="listbox"], [role="dialog"]')) return;
        setQuery('');
        searchInput.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function startNext() {
    // Before anything else: this is what actually takes the success panel off
    // the screen. Everything below it only decides what the form underneath
    // will be showing once it is gone.
    if (result) setDismissed(result.visit_id);
    setIds(newIds());
    setQuery('');
    setChosen(null);
    setEditingChosen(false);
    setGender('female');
    setPhone('');
    setDoctorId('');
    setDepartmentPick(null);
    setFee('');
    setFeeTouched(false);
    setMode('cash');
    setDeferring(false);
    // Both refs are null when this runs from the success panel -- the form is
    // not mounted -- so the focus has to wait for the render that brings it
    // back. formRef.reset() is a no-op in that case and still correct when
    // Cancel calls this with the form on screen.
    formRef.current?.reset();
    refocus.current = true;
  }

  useEffect(() => {
    if (done || !refocus.current) return;
    refocus.current = false;
    searchInput.current?.focus();
  }, [done]);

  // ---- The success panel (block 4.4) ---------------------------------------
  if (done) {
    return (
      <section className="mx-auto grid w-full max-w-2xl gap-5 rounded-2xl border border-success/30 bg-success/5 p-6 sm:p-8">
        <div className="grid gap-1 text-center">
          <span className="text-xs font-semibold tracking-widest text-success uppercase">
            {done.payment_due ? 'Registered - payment due' : 'Registered'}
          </span>
          <span className="text-6xl leading-none font-bold text-success tabular-nums sm:text-7xl">
            {done.token_no}
          </span>
          <span className="text-sm text-muted-foreground">
            Token for {done.doctor_name ?? 'the doctor'}
            {done.department_name ? ` · ${done.department_name}` : ''}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-background/70 px-4 py-3 text-sm sm:grid-cols-4">
          <Fact label="Patient" value={done.patient_name} />
          <Fact label="MRN" value={done.mrn} mono />
          <Fact label="Visit" value={done.visit_no} mono />
          <Fact label="Invoice" value={done.invoice_no} mono />
        </dl>

        {done.payment_due ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning">
            <strong className="font-semibold">Payment due.</strong> This visit carries a PAYMENT
            DUE badge on the queue until billing collects {formatMoney(done.grand_total)}.
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/front-desk/queue">Open the queue</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/print/receipt/${done.invoice_id}`} target="_blank">
              <PrinterIcon data-icon="inline-start" />
              Print receipt
            </Link>
          </Button>
          <Button ref={nextButton} onClick={startNext}>
            <UserRoundPlusIcon data-icon="inline-start" />
            Register next patient
          </Button>
        </div>
      </section>
    );
  }

  const showDemographics = chosen === null || editingChosen;

  return (
    <form ref={formRef} action={action} onKeyDown={onFormKeyDown} className="grid gap-5">
      <input type="hidden" name="patient_new_id" value={ids.patient} />
      <input type="hidden" name="visit_id" value={ids.visit} />
      <input type="hidden" name="invoice_id" value={ids.invoice} />
      <input type="hidden" name="patient_id" value={chosen?.id ?? ''} />
      <input type="hidden" name="gender" value={gender} />
      <input type="hidden" name="doctor_id" value={doctorId} />
      <input
        type="hidden"
        name="department_id"
        value={departmentId === NO_DEPARTMENT ? '' : departmentId}
      />
      <input type="hidden" name="fee" value={effectiveFee} />
      <input type="hidden" name="payment_mode" value={deferring ? '' : mode} />
      <input type="hidden" name="deferred" value={deferring ? 'true' : ''} />

      <FormMessage state={formState} />

      {/* ---- 1. Search ------------------------------------------------------
          The whole screen starts here (CLAUDE.md 3.3). The icon is absolutely
          positioned against the input at left-3 and the input carries pl-10;
          relying on a wrapper's padding is what let the icon sit on top of
          typed text (defect 7). */}
      <section className="grid gap-3">
        <Field
          label="Find the patient"
          htmlFor="patient-search"
          hint={`Phone, name or MRN. ${MIN_QUERY} characters or more. Esc clears.`}
        >
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchInput}
              id="patient-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Phone, name or MRN"
              className="h-11 pl-10 text-base md:h-11 md:pl-10 md:text-base"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        </Field>

        {/* Neutral, never a warning (block 4.1). Two people on one phone number
            is the normal case in an Indian household; this panel exists to save
            a re-type and to prevent a duplicate MRN, not to stop anybody. */}
        {active && (matches.length > 0 || isFetching) ? (
          <div className="grid gap-1 rounded-xl border border-border/60 bg-muted/40 p-2">
            <p className="px-1.5 pb-0.5 text-xs text-muted-foreground">
              {isFetching && matches.length === 0
                ? 'Searching...'
                : `${matches.length} already on file. Use one, or carry on registering a new patient.`}
            </p>
            {matches.map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => {
                  setChosen(fromSearch(match));
                  setEditingChosen(false);
                  setQuery('');
                }}
                className="flex items-center gap-3 rounded-lg bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="font-mono text-xs text-muted-foreground">{match.mrn}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{match.full_name}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {ageGender(match.dob, match.gender)}
                </span>
                <span className="shrink-0 text-xs font-medium text-primary">Use this patient</span>
              </button>
            ))}
          </div>
        ) : null}

        {active && matches.length === 0 && !isFetching ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Nobody matches &ldquo;{query.trim()}&rdquo;. Fill in the details below to register
            them.
          </p>
        ) : null}
      </section>

      {/* ---- 2. Patient ----------------------------------------------------- */}
      <section className="grid gap-4 rounded-xl border border-border/60 p-4 sm:p-5">
        <SectionHead
          step="1"
          title="Patient"
          note={chosen ? 'On file already' : 'A new record'}
        />

        {chosen && !editingChosen ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
            <span className="font-medium">{chosen.full_name}</span>
            <span className="text-xs text-muted-foreground">
              {ageGender(chosen.dob, chosen.gender)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{chosen.mrn}</span>
            {chosen.phone ? (
              <span className="font-mono text-xs text-muted-foreground">{chosen.phone}</span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setChosen(null);
                setQuery('');
                searchInput.current?.focus();
              }}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <PencilIcon className="size-3" />
              Not this patient
            </button>
          </div>
        ) : null}

        {showDemographics ? (
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-5 sm:grid-cols-12">
            <Field
              label="Patient name"
              htmlFor="full_name"
              required
              error={fieldError(state, 'full_name')}
              className="sm:col-span-5"
            >
              <Input
                id="full_name"
                name="full_name"
                defaultValue={prefillFrom(query).full_name}
                maxLength={120}
                autoComplete="off"
                aria-invalid={fieldError(state, 'full_name') !== undefined}
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="phone"
              error={fieldError(state, 'phone')}
              hint="How this patient is found next time."
              className="sm:col-span-4"
            >
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+91 98450 11223"
                autoComplete="off"
                aria-invalid={fieldError(state, 'phone') !== undefined}
              />
            </Field>

            {/* Gender sits with name and phone, not beside the Age fieldset:
                a bordered group carries a legend and its own padding, so a
                plain control next to it can never share a baseline with the
                controls inside it (defect 7). */}
            <Field
              label="Gender"
              htmlFor="gender"
              required
              error={fieldError(state, 'gender')}
              className="sm:col-span-3"
            >
              <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
                <SelectTrigger id="gender" className="w-full">
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

            {/* Date of birth and age are ONE question with two entry modes
                (block 6.3). The border is what says so; two loose fields with
                "or age in years" between them read as two questions. */}
            <FieldSet
              legend="Age"
              hint="Enter either. Age is stored as an approximate date of birth, so it stays correct next year."
              error={fieldError(state, 'dob') ?? fieldError(state, 'age_years')}
              className="sm:col-span-6"
            >
              <div className="grid grid-cols-2 items-start gap-x-4">
                <Field label="Date of birth" htmlFor="dob" collapse>
                  <Input id="dob" name="dob" type="date" />
                </Field>
                <Field label="or age in years" htmlFor="age_years" collapse>
                  <Input
                    id="age_years"
                    name="age_years"
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="42"
                    autoComplete="off"
                  />
                </Field>
              </div>
            </FieldSet>

            <Field
              label="Address"
              htmlFor="address"
              error={fieldError(state, 'address')}
              className="sm:col-span-6"
            >
              <Textarea id="address" name="address" rows={3} maxLength={300} autoComplete="off" />
            </Field>
          </div>
        ) : null}
      </section>

      {/* ---- 3. Visit ------------------------------------------------------- */}
      <section className="grid gap-4 rounded-xl border border-border/60 p-4 sm:p-5">
        <SectionHead step="2" title="Visit" note="The doctor is required" />

        <div className="grid grid-cols-1 items-start gap-x-6 gap-y-5 sm:grid-cols-12">
          <Field
            label="Department"
            htmlFor="department"
            hint="Optional. Narrows the doctor list."
            className="sm:col-span-5"
          >
            <Select
              value={departmentId}
              onValueChange={(value) => {
                setDepartmentPick(value);
                // A doctor left over from another department would be
                // submitted invisibly.
                if (
                  value !== NO_DEPARTMENT &&
                  doctor &&
                  doctor.department_id !== value &&
                  doctors.some((option) => option.department_id === value)
                ) {
                  setDoctorId('');
                }
              }}
            >
              <SelectTrigger id="department" className="h-10 w-full">
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

          <Field
            label="Doctor"
            htmlFor="doctor"
            required
            error={fieldError(state, 'doctor_id')}
            hint="On duty today, with how many are already waiting."
            className="sm:col-span-7"
          >
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger
                id="doctor"
                className="h-10 w-full"
                aria-invalid={fieldError(state, 'doctor_id') !== undefined}
              >
                <SelectValue placeholder="Choose a doctor" />
              </SelectTrigger>
              <SelectContent>
                {visible.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.full_name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {option.waiting === 0 ? 'no queue' : `${option.waiting} waiting`}
                      {option.on_duty ? '' : ' · not rostered'}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </section>

      {/* ---- 4. Payment ----------------------------------------------------- */}
      <section className="grid gap-4 rounded-xl border border-border/60 p-4 sm:p-5">
        <SectionHead
          step="3"
          title="Payment"
          note={deferring ? 'Deferred' : 'Collected at the desk'}
        />

        <div className="grid grid-cols-1 items-start gap-x-6 gap-y-5 sm:grid-cols-12">
          <Field
            label="Consultation fee"
            htmlFor="fee-input"
            error={fieldError(state, 'fee')}
            hint={
              canEditFee
                ? "Prefilled from the doctor's own fee."
                : 'Set from the doctor’s fee. You may not change it.'
            }
            className="sm:col-span-4"
          >
            <Input
              id="fee-input"
              inputMode="decimal"
              value={effectiveFee}
              disabled={!canEditFee || !doctor}
              onChange={(event) => {
                setFeeTouched(true);
                setFee(event.target.value);
              }}
              className="h-10 text-right tabular-nums"
              aria-invalid={fieldError(state, 'fee') !== undefined}
            />
          </Field>

          <Field
            label="Payment mode"
            htmlFor="payment-mode"
            required={!deferring}
            error={fieldError(state, 'payment_mode')}
            hint={deferring ? 'Nothing is collected now.' : 'Required. Who collected it is you.'}
            className="sm:col-span-8"
          >
            <div id="payment-mode" className="flex flex-wrap gap-2">
              {PAYMENT_MODES.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={deferring}
                  aria-pressed={!deferring && mode === option}
                  onClick={() => setMode(option)}
                  className={cn(
                    'h-10 min-w-20 rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    deferring
                      ? 'cursor-not-allowed border-border/60 text-muted-foreground/50'
                      : mode === option
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {PAYMENT_MODE_LABEL[option]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Rare, visible and auditable -- not a silent skip (block 4.2 step 5). */}
        {canDefer ? (
          deferring ? (
            <Field
              label="Why is the patient being seen before paying?"
              htmlFor="defer_reason"
              required
              error={fieldError(state, 'defer_reason')}
              hint="Recorded against your name and shown on the queue as PAYMENT DUE."
            >
              <div className="flex gap-2">
                <Input
                  id="defer_reason"
                  name="defer_reason"
                  maxLength={200}
                  autoFocus
                  placeholder="Emergency, will settle at discharge"
                  aria-invalid={fieldError(state, 'defer_reason') !== undefined}
                />
                <Button type="button" variant="ghost" onClick={() => setDeferring(false)}>
                  Cancel
                </Button>
              </div>
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setDeferring(true)}
              className="justify-self-start text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Patient cannot pay now
            </button>
          )
        ) : null}
      </section>

      {/* ---- Footer --------------------------------------------------------- */}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:rounded-xl sm:border sm:px-4">
        <span className="hidden items-center gap-4 sm:flex">
          <KbdHint keys={['Ctrl', 'Enter']} always>
            register
          </KbdHint>
          <KbdHint keys="Esc" always>
            clear search
          </KbdHint>
        </span>

        <span className="text-sm text-muted-foreground sm:ml-auto">
          {deferring ? (
            <>
              <BanknoteIcon className="mr-1 inline size-4 align-text-bottom" />
              Nothing collected
            </>
          ) : (
            <>
              Collecting{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {formatMoney(Number(effectiveFee) || 0)}
              </strong>
            </>
          )}
        </span>

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={startNext}>
            Cancel
          </Button>
          <SubmitButton pendingLabel="Registering...">
            <TicketIcon data-icon="inline-start" />
            Register &amp; collect
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

function newIds() {
  return {
    patient: crypto.randomUUID(),
    visit: crypto.randomUUID(),
    invoice: crypto.randomUUID(),
  };
}

function SectionHead({ step, title, note }: { step: string; title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
        {step}
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={cn('truncate text-sm font-medium', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

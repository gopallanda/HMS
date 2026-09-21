'use client';

import {
  BanknoteIcon,
  CheckIcon,
  PencilIcon,
  PrinterIcon,
  RotateCcwIcon,
  TicketIcon,
  UserRoundPlusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { registerAction, type RegisterState } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { KbdHint } from '@/components/shared/kbd';
import { usePatientSearch } from '@/components/shared/patient-search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fieldError, IDLE, type FieldErrors } from '@/lib/action-state';
import { PAYMENT_MODES, PAYMENT_MODE_LABEL, type PaymentMode } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { ageGender, GENDERS, GENDER_LABEL, type Gender } from '@/lib/patients';
import type { PatientSearchResult } from '@/lib/rpc/patients';
import { registrationSchema } from '@/lib/schemas/registration';
import { formatMoney } from '@/lib/utils/money';

/**
 * The register desk.
 *
 * ONE form, one RPC, one transaction (block 4.2). Nothing is written until
 * submit, and what is written is complete: patient, visit, token, invoice, and
 * either the payment or a recorded deferral.
 *
 * One way in: the patient's name. There is no separate search box to go
 * through first -- the name field IS the search (CLAUDE.md 3.3). As it is
 * typed, anybody already on file with a name like it is listed with their
 * mobile number; once a whole phone number is typed, a row with the same number
 * is marked and sorted first. Tapping a row uses that patient; carrying on
 * creates a new one. The save is never blocked.
 *
 * What makes it fast, because this is the screen that decides adoption:
 *
 *   * The form is validated in the browser with the SAME zod schema the action
 *     uses, so a missing field is answered instantly, not after a round trip.
 *   * Submitted through startTransition, not <form action>: React resets an
 *     action form after every submission, which wiped everything typed
 *     whenever the server said no.
 *   * Typing does not re-render the form. The name and phone reach state only
 *     after a pause, and only because the match list needs them.
 *   * One tap for gender and doctor, instead of opening a dropdown each time.
 *   * Enter moves to the next field; Ctrl+Enter registers.
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

/** More doctors than this and one-tap cards stop being quicker than a list. */
const DOCTOR_CARD_LIMIT = 8;

/** How long a pause in typing before the name or phone is searched. */
const TYPING_PAUSE_MS = 120;

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

/** The last ten digits: +91 98450 11223 and 09845011223 are the same mobile. */
function phoneKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10);
}

/** Which element to focus for a field that failed validation. */
const FOCUS_FOR: Record<string, string> = {
  full_name: 'full_name',
  phone: 'phone',
  age_years: 'age_years',
  dob: 'age_years',
  gender: 'gender',
  address: 'address',
  doctor_id: 'doctor',
  payment_mode: 'payment-mode',
  defer_reason: 'defer_reason',
  fee: 'fee-input',
};

/** The selected doctor card, else the first one, else the dropdown. */
function focusDoctor() {
  const target =
    document.querySelector<HTMLElement>('[data-doctor][aria-checked="true"]') ??
    document.querySelector<HTMLElement>('[data-doctor]') ??
    document.getElementById('doctor');
  target?.focus();
}

/** Focus the first field that failed, in screen order, not zod's. */
function focusFirst(names: string[]) {
  // In the order the fields appear on screen, not the order zod reported.
  const order = Object.keys(FOCUS_FOR);
  const first = names
    .filter((name) => name in FOCUS_FOR)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  if (!first) return;
  requestAnimationFrame(() => {
    if (first === 'doctor_id') return focusDoctor();
    const element = document.getElementById(FOCUS_FOR[first]!);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

/**
 * Patients already on file, one row each, for the clerk to pick from.
 *
 * The mobile number is on every row because it is what the clerk checks with
 * the person at the counter: a name alone cannot tell two Lakshmis apart, and
 * a shared household phone alone cannot tell a mother from her daughter.
 *
 * Up and Down move between rows, Enter picks (they are buttons).
 */
function MatchList({
  matches,
  note,
  onPick,
  listRef,
  samePhone,
}: {
  matches: PatientSearchResult[];
  note: string;
  onPick: (match: PatientSearchResult) => void;
  listRef?: React.Ref<HTMLDivElement>;
  /** Rows whose mobile matches the one typed. Marked, and the likely pick. */
  samePhone?: (match: PatientSearchResult) => boolean;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    event.preventDefault();
    const next =
      event.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
    rows[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      onKeyDown={onKeyDown}
      className="grid gap-1.5 rounded-2xl border border-border/60 bg-muted/40 p-2 md:gap-1 md:rounded-xl"
    >
      <p className="px-1.5 pt-0.5 pb-1 text-xs leading-snug text-muted-foreground md:pt-0 md:pb-0.5">
        {note}
      </p>
      {matches.map((match) => {
        const same = samePhone?.(match) ?? false;
        return (
          <button
            key={match.id}
            type="button"
            onClick={() => onPick(match)}
            className={cn(
              'flex items-center gap-3 rounded-xl bg-background px-3 py-2.5 text-left text-sm shadow-xs transition outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] md:rounded-lg md:py-2 md:shadow-none',
              same && 'ring-1 ring-success/50',
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary sm:hidden">
              {match.full_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:block">
              {match.mrn}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{match.full_name}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:hidden">
                {ageGender(match.dob, match.gender)} · <span className="font-mono">{match.mrn}</span>
              </span>
            </span>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {ageGender(match.dob, match.gender)}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 sm:w-36">
              <span className={cn('font-mono text-xs', match.phone ? '' : 'text-muted-foreground')}>
                {match.phone ?? 'No mobile'}
              </span>
              {same ? (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold tracking-wide text-success uppercase">
                  <CheckIcon className="size-3" />
                  Same phone
                </span>
              ) : null}
            </span>
            <span className="hidden shrink-0 text-xs font-medium text-primary sm:block">
              Use this patient
            </span>
          </button>
        );
      })}
    </div>
  );
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
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerAction, IDLE);

  /**
   * One generation of ids per registration. Regenerated only when the desk
   * starts the NEXT patient, so a resubmit after a dropped connection returns
   * the same patient, visit and invoice instead of a second set (CLAUDE.md 7).
   */
  const [ids, setIds] = useState(newIds);

  /**
   * The registration whose success panel has been dismissed. useActionState
   * owns `state` and cannot be cleared from here, so the panel is keyed on the
   * visit id rather than a boolean.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  /** Set while the form is coming back, so focus lands after it has mounted. */
  const refocus = useRef(false);

  const [chosen, setChosen] = useState<DeskPatient | null>(initialPatient);

  /**
   * NO DEFAULT, deliberately. This started as useState<Gender>('female') and
   * a hidden input that always posted, so the field was marked required, was
   * validated by the schema, and could not fail: every patient a clerk did not
   * explicitly tap was recorded female. Gender is a clinical field on a
   * patient record, and a wrong one entered silently is worse than one more
   * tap on the screen that decides adoption.
   */
  const [gender, setGender] = useState<Gender | ''>('');
  const [doctorId, setDoctorId] = useState('');
  const [departmentPick, setDepartmentPick] = useState<string | null>(null);
  const [fee, setFee] = useState('');
  const [feeTouched, setFeeTouched] = useState(false);
  const [payMode, setPayMode] = useState<PaymentMode | ''>('cash');
  const [deferring, setDeferring] = useState(false);

  /** Answered in the browser, before the round trip. Null once submitted. */
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  // ---- Name and phone matching ---------------------------------------------
  // Both inputs are uncontrolled. Their values reach state only after a pause
  // in typing, so a keystroke repaints one input, not the whole form.
  const [nameTyped, setNameTyped] = useState('');
  const [phoneTyped, setPhoneTyped] = useState('');

  /**
   * ONE TIMER PER FIELD. They shared a single ref, which meant the first
   * keystroke in the phone box cancelled the name's pending update and vice
   * versa: type a name and start the mobile number inside the pause and the
   * name search ran on a stale prefix, or never ran at all. The row it would
   * have shown is the only thing standing between a returning patient and a
   * second MRN (CLAUDE.md 3.3), so losing it quietly is the expensive half of
   * the bug -- nothing on screen says the search did not happen.
   */
  const nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function typed(
    timer: React.RefObject<ReturnType<typeof setTimeout> | undefined>,
    setter: (value: string) => void,
    value: string,
  ) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setter(value.trim()), TYPING_PAUSE_MS);
  }

  // Both timers die with the component: a fire after unmount is a setState on
  // nothing, and on this screen the unmount is the success panel replacing the
  // form.
  useEffect(() => {
    // The REFS are captured, not their contents: the timer to cancel is
    // whichever one is pending at unmount, not whichever was pending when the
    // effect ran. Captured this way round exhaustive-deps is satisfied too --
    // its warning is about refs holding DOM nodes.
    const timers = [nameTimer, phoneTimer];
    return () => {
      for (const timer of timers) clearTimeout(timer.current);
    };
  }, []);

  const matching = chosen === null;
  const typedPhone = phoneKey(phoneTyped);
  const nameSearch = usePatientSearch(nameTyped, matching);
  // A whole mobile number finds the household even when the name was spelt
  // differently last time.
  const phoneSearch = usePatientSearch(typedPhone.length === 10 ? typedPhone : '', matching);

  const samePhone = (match: PatientSearchResult) =>
    typedPhone.length === 10 && phoneKey(match.phone) === typedPhone;

  const suggestions = useMemo(() => {
    if (!matching) return [];
    const rows = [
      ...(nameSearch.active ? (nameSearch.data ?? []) : []),
      ...(phoneSearch.active ? (phoneSearch.data ?? []) : []),
    ];
    const seen = new Set<string>();
    const unique = rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
    const key = typedPhone.length === 10 ? typedPhone : null;
    // Same phone first: that row is most likely the person at the counter.
    return unique
      .sort((a, b) => Number(phoneKey(b.phone) === key) - Number(phoneKey(a.phone) === key))
      .slice(0, 6);
  }, [matching, nameSearch.active, nameSearch.data, phoneSearch.active, phoneSearch.data, typedPhone]);
  const suggestionList = useRef<HTMLDivElement>(null);

  function pick(match: PatientSearchResult) {
    setChosen(fromSearch(match));
    setNameTyped('');
    setPhoneTyped('');
    setClientErrors(null);
    // The row that had focus is about to unmount. Hand focus to the next
    // question on the form rather than dropping it on <body>.
    requestAnimationFrame(() => focusDoctor());
  }

  function notThisPatient() {
    setChosen(null);
    setNameTyped('');
    setPhoneTyped('');
    setClientErrors(null);
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  // ---- Doctors --------------------------------------------------------------

  /**
   * Registrations made at this desk since the page loaded, per doctor. The
   * action no longer refreshes the page after every registration (that was a
   * second round trip before the token showed), so the desk keeps its own
   * waiting counts current instead.
   */
  const [counted, setCounted] = useState<string | null>(null);
  const [bumps, setBumps] = useState<Record<string, number>>({});
  const result = state.status === 'success' ? state.result : undefined;
  if (result && result.visit_id !== counted) {
    setCounted(result.visit_id);
    const id = result.doctor_id;
    if (id) setBumps((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  const doctor = doctors.find((option) => option.id === doctorId);
  const departmentId = departmentPick ?? doctor?.department_id ?? NO_DEPARTMENT;

  /**
   * Doctors, narrowed to the chosen department. Never narrowed to nothing: a
   * department with no doctor assigned would otherwise leave the desk unable
   * to register anybody.
   */
  const visible = useMemo(() => {
    const all = doctors.map((option) => ({
      ...option,
      waiting: option.waiting + (bumps[option.id] ?? 0),
    }));
    if (departmentPick === null || departmentPick === NO_DEPARTMENT) return all;
    const inDepartment = all.filter((option) => option.department_id === departmentPick);
    return inDepartment.length > 0 ? inDepartment : all;
  }, [doctors, departmentPick, bumps]);

  const doctorCards = visible.length <= DOCTOR_CARD_LIMIT;

  // The fee follows whichever doctor is selected until somebody types over it.
  const effectiveFee = feeTouched ? fee : doctor ? String(doctor.consultation_fee) : '';

  const done = result && result.visit_id !== dismissed ? result : undefined;

  /**
   * The banner belongs to the registration that produced it. Once its panel is
   * dismissed the next patient starts on a clean form.
   */
  const formState = result && result.visit_id === dismissed ? IDLE : state;

  /** Browser-side errors win until the next submit; then the server's. */
  function errorFor(name: string): string | undefined {
    if (clientErrors) return clientErrors[name]?.[0];
    return fieldError(formState, name);
  }

  function clearError(...names: string[]) {
    if (!clientErrors || !names.some((name) => clientErrors[name])) return;
    const next = { ...clientErrors };
    for (const name of names) delete next[name];
    setClientErrors(next);
  }

  useEffect(() => {
    if (done) {
      toast.success(`Token ${done.token_no} - ${done.patient_name}`, {
        description: `${done.mrn} · ${done.invoice_no}`,
      });
      // The form was scrolled to its footer; the token is at the top.
      window.scrollTo({ top: 0 });
      nextButton.current?.focus();
    }
  }, [done]);

  // A refusal from the server: put the cursor on the first field it names.
  useEffect(() => {
    if (state.status !== 'error' || !state.fieldErrors) return;
    focusFirst(Object.keys(state.fieldErrors));
  }, [state]);

  /**
   * Enter moves to the next field (CLAUDE.md 7), Ctrl+Enter registers. Only
   * elements marked data-step take part, in DOM order, so the tab stops that
   * are not questions -- "Not this patient", the payment modes -- are skipped.
   */
  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter') return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    event.preventDefault();
    const steps = Array.from(
      formRef.current?.querySelectorAll<HTMLElement>('[data-step]') ?? [],
    ).filter((element) => !(element as HTMLInputElement).disabled);
    const at = steps.indexOf(target);
    if (at === -1) return;
    const next = steps[at + 1];
    if (!next) formRef.current?.requestSubmit();
    else if (next.hasAttribute('data-doctor-step')) focusDoctor();
    else next.focus();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);

    // The same schema the action parses, run here first: a missing field is
    // answered now, not after a round trip to the database and back.
    const parsed = registrationSchema.safeParse(
      Object.fromEntries(Array.from(formData.keys()).map((key) => [key, formData.get(key)])),
    );
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors as FieldErrors;
      setClientErrors(flat);
      focusFirst(Object.keys(flat));
      return;
    }

    setClientErrors(null);
    startTransition(() => action(formData));
  }

  function startNext() {
    // Before anything else: this is what actually takes the success panel off
    // the screen.
    if (result) setDismissed(result.visit_id);
    setIds(newIds());
    setNameTyped('');
    setPhoneTyped('');
    setChosen(null);
    setGender('');
    setDoctorId('');
    setDepartmentPick(null);
    setFee('');
    setFeeTouched(false);
    setPayMode('cash');
    setDeferring(false);
    setClientErrors(null);
    formRef.current?.reset();
    refocus.current = true;
  }

  useEffect(() => {
    if (done || !refocus.current) return;
    refocus.current = false;
    nameInput.current?.focus();
  }, [done]);

  // ---- The success panel (block 4.4) ---------------------------------------
  if (done) {
    return (
      <section className="mx-auto grid w-full max-w-2xl gap-5 rounded-3xl border border-success/30 bg-success/5 p-5 sm:rounded-2xl sm:p-8">
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

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl bg-background/70 px-4 py-3.5 text-sm sm:grid-cols-4 sm:gap-y-2 sm:rounded-xl sm:py-3">
          <Fact label="Patient" value={done.patient_name} />
          <Fact label="MRN" value={done.mrn} mono />
          <Fact label="Visit" value={done.visit_no} mono />
          <Fact label="Invoice" value={done.invoice_no} mono />
        </dl>

        {done.payment_due ? (
          <p className="rounded-xl bg-warning/10 px-3.5 py-3 text-sm text-warning sm:rounded-lg sm:px-3 sm:py-2.5">
            <strong className="font-semibold">Payment due.</strong> This visit carries a PAYMENT
            DUE badge on the queue until billing collects {formatMoney(done.grand_total)}.
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-2">
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

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onKeyDown={onFormKeyDown}
      noValidate
      className="grid min-w-0 gap-4 md:gap-5"
    >
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
      <input type="hidden" name="payment_mode" value={deferring ? '' : payMode} />
      <input type="hidden" name="deferred" value={deferring ? 'true' : ''} />

      <FormMessage state={clientErrors ? IDLE : formState} />

      {/* ---- The patient ----------------------------------------------------- */}
      {chosen ? (
        <section className={SECTION}>
          <SectionHead step="1" title="Patient" note="On file already" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-primary/5 px-3 py-3 text-sm ring-1 ring-primary/15 md:rounded-lg md:bg-muted/60 md:py-2.5 md:ring-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground md:hidden">
              {chosen.full_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5 md:flex md:flex-none md:items-center md:gap-3">
              <span className="truncate font-semibold md:font-medium">{chosen.full_name}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground md:gap-x-3">
                <span>{ageGender(chosen.dob, chosen.gender)}</span>
                <span className="font-mono">{chosen.mrn}</span>
                {chosen.phone ? <span className="font-mono">{chosen.phone}</span> : null}
              </span>
            </span>
            <button
              type="button"
              onClick={notThisPatient}
              className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-primary hover:underline max-md:mt-1 max-md:bg-background md:ml-auto md:w-auto md:py-0"
            >
              <PencilIcon className="size-3" />
              Not this patient
            </button>
          </div>
        </section>
      ) : null}

      {chosen === null ? (
        <section className={SECTION}>
          <SectionHead step="1" title="Patient" note="All fields required" />

          {/* One grid, every control the same height, so the rows line up:
              name and phone, then age, gender and address. On a phone the
              only pair is age beside gender. */}
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 sm:grid-cols-12 sm:gap-x-4 md:gap-y-4">
            <Field
              label="Patient name"
              htmlFor="full_name"
              required
              error={errorFor('full_name')}
              hint="Patients already on file appear below after 3 letters."
              className="col-span-2 sm:col-span-6"
            >
              <Input
                ref={nameInput}
                id="full_name"
                name="full_name"
                data-step
                autoFocus
                onChange={(event) => {
                  typed(nameTimer, setNameTyped, event.target.value);
                  clearError('full_name');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && suggestions.length > 0) {
                    event.preventDefault();
                    suggestionList.current?.querySelector('button')?.focus();
                  }
                }}
                maxLength={120}
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
                placeholder="Full name"
                className={CONTROL}
                aria-invalid={errorFor('full_name') !== undefined}
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="phone"
              required
              error={errorFor('phone')}
              className="col-span-2 sm:col-span-6"
            >
              <Input
                id="phone"
                name="phone"
                data-step
                type="tel"
                inputMode="tel"
                onChange={(event) => {
                  typed(phoneTimer, setPhoneTyped, event.target.value);
                  clearError('phone');
                }}
                placeholder="98450 11223"
                autoComplete="off"
                enterKeyHint="next"
                className={CONTROL}
                aria-invalid={errorFor('phone') !== undefined}
              />
            </Field>

            {/* Only when something matches, so the common case -- a new
                name -- does not make the form jump. Neutral, never a
                warning: the save is never blocked (CLAUDE.md 3.3). */}
            {suggestions.length > 0 ? (
              <div className="col-span-2 sm:col-span-12">
                <MatchList
                  listRef={suggestionList}
                  matches={suggestions}
                  samePhone={samePhone}
                  note={
                    suggestions.some(samePhone)
                      ? 'Already on file with this phone number. Tap the patient to use their record.'
                      : 'Already on file with a name like this. If the mobile number matches, tap to use that patient; otherwise carry on.'
                  }
                  onPick={pick}
                />
              </div>
            ) : null}

            <Field
              label="Age"
              htmlFor="age_years"
              required
              error={errorFor('age_years') ?? errorFor('dob')}
              className="sm:col-span-2"
            >
              <Input
                id="age_years"
                name="age_years"
                data-step
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                placeholder="Years"
                autoComplete="off"
                enterKeyHint="next"
                onChange={() => clearError('age_years', 'dob')}
                className={cn(CONTROL, 'tabular-nums')}
                aria-invalid={(errorFor('age_years') ?? errorFor('dob')) !== undefined}
              />
            </Field>

            <Field
              label="Gender"
              htmlFor="gender"
              required
              error={errorFor('gender')}
              className="sm:col-span-4"
            >
              <div
                id="gender"
                role="radiogroup"
                aria-label="Gender"
                // focusFirst() calls .focus() on this element by id when the
                // schema rejects an unanswered gender. A plain div ignores
                // that, and the clerk would be sent to a field with no cursor.
                tabIndex={-1}
                className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1 md:rounded-lg"
              >
                {GENDERS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={gender === option}
                    onClick={() => {
                      setGender(option);
                      clearError('gender');
                    }}
                    className={cn(
                      'h-9 min-w-0 truncate rounded-lg px-1 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:h-8 md:rounded-md',
                      gender === option
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground',
                    )}
                  >
                    {GENDER_LABEL[option]}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Address"
              htmlFor="address"
              required
              error={errorFor('address')}
              className="col-span-2 sm:col-span-6"
            >
              <Input
                id="address"
                name="address"
                data-step
                maxLength={300}
                placeholder="Village / area, town"
                autoComplete="off"
                enterKeyHint="next"
                onChange={() => clearError('address')}
                className={CONTROL}
                aria-invalid={errorFor('address') !== undefined}
              />
            </Field>
          </div>
        </section>
      ) : null}

      <>
          {/* ---- The visit --------------------------------------------------- */}
          <section className={SECTION}>
            <SectionHead step="2" title="Doctor" note="Required" />

            <div className="grid grid-cols-1 items-start gap-x-6 gap-y-3 sm:grid-cols-12 md:gap-y-4">
              {departments.length > 0 ? (
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
                    <SelectTrigger id="department" className="h-11 w-full md:h-10">
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
              ) : null}

              <Field
                label="Doctor"
                htmlFor="doctor"
                required
                error={errorFor('doctor_id')}
                hint={doctorCards ? undefined : 'On duty today, with how many are already waiting.'}
                className="sm:col-span-12"
              >
                {/* The marker Enter uses to reach this question from Address. */}
                <span data-step data-doctor-step hidden />
                {doctorCards ? (
                  <div
                    id="doctor"
                    role="radiogroup"
                    aria-label="Doctor"
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {visible.map((option) => {
                      const selected = option.id === doctorId;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          data-doctor
                          aria-checked={selected}
                          onClick={() => {
                            setDoctorId(option.id);
                            clearError('doctor_id');
                          }}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] md:rounded-lg md:py-2',
                            selected
                              ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                              : 'border-border bg-background hover:border-primary/40',
                            errorFor('doctor_id') && !doctorId && 'border-destructive/60',
                          )}
                        >
                          <span
                            className={cn(
                              'grid size-5 shrink-0 place-items-center rounded-full border',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/40',
                            )}
                          >
                            {selected ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate', selected ? 'font-semibold' : 'font-medium')}>
                              {option.full_name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {option.waiting === 0 ? 'No queue' : `${option.waiting} waiting`}
                              {option.on_duty ? '' : ' · not rostered'}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs font-medium text-muted-foreground tabular-nums">
                            {formatMoney(option.consultation_fee)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Select
                    value={doctorId}
                    onValueChange={(value) => {
                      setDoctorId(value);
                      clearError('doctor_id');
                    }}
                  >
                    <SelectTrigger
                      id="doctor"
                      className="h-11 w-full md:h-10"
                      aria-invalid={errorFor('doctor_id') !== undefined}
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
                )}
              </Field>
            </div>
          </section>

          {/* ---- Payment ----------------------------------------------------- */}
          <section className={SECTION}>
            <SectionHead
              step="3"
              title="Payment"
              note={deferring ? 'Deferred' : 'Collected at the desk'}
            />

            <div className="grid grid-cols-1 items-start gap-x-6 gap-y-3 sm:grid-cols-12 md:gap-y-4">
              <Field
                label="Consultation fee"
                htmlFor="fee-input"
                error={errorFor('fee')}
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
                  className="h-11 text-right text-lg font-semibold tabular-nums md:h-10 md:text-sm md:font-normal"
                  aria-invalid={errorFor('fee') !== undefined}
                />
              </Field>

              <Field
                label="Payment mode"
                htmlFor="payment-mode"
                required={!deferring}
                error={errorFor('payment_mode')}
                hint={deferring ? 'Nothing is collected now.' : 'Who collected it is you.'}
                className="sm:col-span-8"
              >
                <div id="payment-mode" tabIndex={-1} className="grid grid-cols-4 gap-2 outline-none sm:flex sm:flex-wrap">
                  {PAYMENT_MODES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={deferring}
                      aria-pressed={!deferring && payMode === option}
                      onClick={() => {
                        setPayMode(option);
                        clearError('payment_mode');
                      }}
                      className={cn(
                        'h-11 rounded-xl border px-2 text-sm font-medium transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.97] sm:h-10 sm:min-w-20 sm:rounded-lg sm:px-4',
                        deferring
                          ? 'cursor-not-allowed border-border/60 text-muted-foreground/50'
                          : payMode === option
                            ? 'border-primary bg-primary/10 font-semibold text-primary ring-1 ring-primary/30'
                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      {PAYMENT_MODE_LABEL[option]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {/* Rare, visible and auditable -- not a silent skip. */}
            {canDefer ? (
              deferring ? (
                <Field
                  label="Why is the patient being seen before paying?"
                  htmlFor="defer_reason"
                  required
                  error={errorFor('defer_reason')}
                  hint="Recorded against your name and shown on the queue as PAYMENT DUE."
                >
                  <div className="flex gap-2">
                    <Input
                      id="defer_reason"
                      name="defer_reason"
                      maxLength={200}
                      autoFocus
                      placeholder="Emergency, will settle at discharge"
                      onChange={() => clearError('defer_reason')}
                      aria-invalid={errorFor('defer_reason') !== undefined}
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
                  className="justify-self-start py-1 text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground md:py-0 md:text-xs"
                >
                  Patient cannot pay now
                </button>
              )
            ) : null}
          </section>

          {/* ---- Footer ------------------------------------------------------ */}
          {/* The end of the form, in the flow. On a phone it used to be sticky
              above the tab bar, so it floated over every section while
              scrolling and covered the fields being filled in. From `md` it
              stays pinned to the bottom of the window, where there is room. */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card py-2.5 pr-2.5 pl-4 shadow-sm md:sticky md:bottom-0 md:z-20 md:rounded-xl md:bg-background/95 md:px-4 md:py-3 md:shadow-none md:backdrop-blur">
            <span className="hidden items-center gap-4 sm:flex">
              <KbdHint keys={['Ctrl', 'Enter']} always>
                register
              </KbdHint>
              <KbdHint keys="Enter" always>
                next field
              </KbdHint>
            </span>

            <span className="min-w-0 flex-1 text-sm text-muted-foreground sm:ml-auto sm:flex-none">
              {deferring ? (
                <>
                  <BanknoteIcon className="mr-1 inline size-4 align-text-bottom" />
                  Nothing collected
                </>
              ) : (
                <>
                  <span className="block text-[11px] leading-tight font-medium tracking-wide uppercase sm:inline sm:text-sm sm:font-normal sm:tracking-normal sm:normal-case">
                    Collecting{' '}
                  </span>
                  <strong className="block truncate text-lg leading-tight font-bold text-foreground tabular-nums sm:inline sm:text-sm sm:font-semibold">
                    {formatMoney(Number(effectiveFee) || 0)}
                  </strong>
                </>
              )}
            </span>

            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={startNext}
                disabled={pending}
                aria-label="Cancel and start over"
                className="max-sm:w-11 max-sm:px-0"
              >
                <RotateCcwIcon className="sm:hidden" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
              <Button type="submit" disabled={pending} className="min-w-32">
                {pending ? (
                  <>
                    <span
                      aria-hidden
                      className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                    />
                    Registering
                  </>
                ) : (
                  <>
                    <TicketIcon data-icon="inline-start" />
                    Register<span className="hidden sm:inline">&nbsp;&amp; collect</span>
                  </>
                )}
              </Button>
            </div>
          </div>
      </>
    </form>
  );
}

/** Every text control on the patient step: one height, so the rows line up. */
const CONTROL = 'h-11 md:h-10';

function newIds() {
  return {
    patient: crypto.randomUUID(),
    visit: crypto.randomUUID(),
    invoice: crypto.randomUUID(),
  };
}

/** A step of the form: a white card on a phone, an outlined panel on the desk. */
const SECTION =
  'grid gap-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm md:rounded-xl md:bg-transparent md:p-5 md:shadow-none';

function SectionHead({ step, title, note }: { step: string; title: string; note: string }) {
  return (
    <div className="flex items-center gap-2.5 md:items-baseline">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground md:size-5 md:bg-primary/10 md:text-[11px] md:text-primary">
        {step}
      </span>
      <h2 className="text-base font-semibold md:text-sm">{title}</h2>
      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground md:ml-0 md:bg-transparent md:p-0 md:text-xs md:font-normal">
        {note}
      </span>
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

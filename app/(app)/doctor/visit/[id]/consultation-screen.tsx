'use client';

import { LockIcon, PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { saveConsultationAction, type SaveConsultationState } from './actions';
import { PrescriptionEditor } from './prescription-editor';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { KbdHint } from '@/components/shared/kbd';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE } from '@/lib/action-state';
import {
  VITALS,
  vitalToInput,
  type Consultation,
  type PrescriptionLine,
} from '@/lib/consultations';
import { GENDER_LABEL, type Gender } from '@/lib/patients';
import { formatAge } from '@/lib/utils/age-from-dob';
import { formatDate, formatDateTime, formatTime } from '@/lib/utils/dates';
import {
  VISIT_STATUS_LABEL,
  VISIT_STATUS_VARIANT,
  VISIT_TYPE_LABEL,
  type VisitStatus,
  type VisitType,
} from '@/lib/visits';

export type ConsultationVisit = {
  id: string;
  visit_no: string;
  token_no: number;
  visit_type: VisitType;
  status: VisitStatus;
  visited_at: string;
  patient_id: string;
  patient_mrn: string;
  patient_name: string;
  patient_dob: string;
  patient_gender: Gender;
  patient_phone: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  department_name: string | null;
  /** An invoice on this visit is still unpaid or part paid. */
  payment_due: boolean;
  /** Set when the desk let them through without paying, and why. */
  defer_reason: string | null;
};

export type PastVisit = {
  id: string;
  visit_no: string;
  visited_at: string;
  visit_type: VisitType;
  status: VisitStatus;
  doctor_name: string | null;
  department_name: string | null;
};

/**
 * The consultation screen: who the patient is, what their numbers are, what
 * the doctor wants to write down, and what the patient walks out holding.
 *
 * The prescription is the fourth thing and the reason the screen gets opened
 * at all in an OPD (item 7). Structured history and diagnosis coding are still
 * a later phase (CLAUDE.md 1); the prescription is free text with no drug
 * master behind it precisely so it does not become a half-built pharmacy
 * module.
 */
export function ConsultationScreen({
  visit,
  history,
  consultation,
  readOnly,
  canPrescribe,
  prescription,
}: {
  visit: ConsultationVisit;
  /** null when the history could not be read -- not the same as "none". */
  history: PastVisit[] | null;
  consultation: Consultation | null;
  readOnly: boolean;
  /**
   * prescription.create.
   *
   * A prop rather than <Can>, for the same reason the collect desk takes one:
   * this is a Client Component and <Can> is a Server Component. It is
   * decoration either way -- saveConsultationAction re-checks the permission
   * whenever a non-empty list arrives, which is the real boundary.
   */
  canPrescribe: boolean;
  /** What was written last time, already parsed out of the jsonb column. */
  prescription: PrescriptionLine[];
}) {
  const router = useRouter();
  const [state, action] = useActionState<SaveConsultationState, FormData>(
    saveConsultationAction,
    IDLE,
  );

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const firstVitalRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * One id for this visit's record, minted once (CLAUDE.md 7). An existing
   * consultation keeps its own id; a new one gets a client-generated uuid, so
   * a form resubmitted after a dropped connection writes the same row rather
   * than racing the unique constraint.
   */
  const [recordId] = useState(() => consultation?.id ?? crypto.randomUUID());

  const isClosed = visit.status === 'completed' || visit.status === 'cancelled';

  /**
   * Where the cursor lands. If somebody has already taken the vitals -- which
   * is the normal shape, a nurse before the doctor -- the doctor's job is the
   * note, so start there. Otherwise start at the top of the vitals.
   */
  useEffect(() => {
    if (readOnly) return;
    const target = consultation ? notesRef.current : firstVitalRef.current;
    target?.focus();
  }, [consultation, readOnly]);

  useEffect(() => {
    if (state.status !== 'success') return;
    toast.success(state.message);
    // A completed visit is off the queue, and the doctor's next patient is on
    // it. Staying on a finished consultation would just need a second click.
    if (state.completed) router.push('/doctor/queue');
  }, [state, router]);

  /** Escape goes back to the queue; Ctrl/Cmd+S saves without completing. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('[role="dialog"]')) return;
        event.preventDefault();
        router.push('/doctor/queue');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (readOnly) return;
        event.preventDefault();
        // requestSubmit takes the submitter, so Ctrl+S means exactly what the
        // Save button means -- including the status it carries.
        formRef.current?.requestSubmit(
          formRef.current.querySelector<HTMLButtonElement>('#save-consultation'),
        );
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [router, readOnly]);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* ------------------------------------------------------------------ */}
      {/* Who is in the room                                                  */}
      {/* ------------------------------------------------------------------ */}
      <aside className="grid content-start gap-4">
        <Card>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground tabular-nums">
                  {visit.token_no}
                </span>
                <div className="min-w-0">
                  {/* The name is the way into the full record -- every visit,
                      every note, and (for whoever may see it) every bill. */}
                  <Link
                    href={`/patients/${visit.patient_id}`}
                    className="block truncate font-medium underline-offset-4 hover:underline"
                  >
                    {visit.patient_name}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{visit.patient_mrn}</p>
                </div>
              </div>
              <Badge variant={VISIT_STATUS_VARIANT[visit.status]} className="shrink-0">
                {VISIT_STATUS_LABEL[visit.status]}
              </Badge>
            </div>

            {/* On the visit header as well as the queue row (block 4.5). The
                doctor is the last person who sees the patient before they walk
                out, so this is the last chance anybody has to mention it. */}
            {visit.payment_due ? (
              <p className="rounded-lg bg-warning/10 px-2.5 py-2 text-xs text-warning">
                <strong className="font-semibold tracking-wide uppercase">Payment due</strong>
                {visit.defer_reason ? ` - ${visit.defer_reason}` : ''}
              </p>
            ) : null}

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs">
              <dt className="text-muted-foreground">Age</dt>
              <dd className="tabular-nums">
                {formatAge(visit.patient_dob)}{' '}
                <span className="text-muted-foreground">
                  ({formatDate(visit.patient_dob)})
                </span>
              </dd>

              <dt className="text-muted-foreground">Sex</dt>
              <dd>{GENDER_LABEL[visit.patient_gender]}</dd>

              <dt className="text-muted-foreground">Phone</dt>
              <dd className="tabular-nums">{visit.patient_phone ?? '-'}</dd>

              <dt className="text-muted-foreground">Type</dt>
              <dd>{VISIT_TYPE_LABEL[visit.visit_type]}</dd>

              <dt className="text-muted-foreground">Doctor</dt>
              <dd className="truncate">{visit.doctor_name ?? 'Not assigned'}</dd>

              <dt className="text-muted-foreground">Dept</dt>
              <dd className="truncate">{visit.department_name ?? '-'}</dd>
            </dl>
          </CardContent>
        </Card>

        {/* Past visit dates. The question this answers is "have I seen this
            person before, and when" -- so it is dates first, not a wall of
            detail. Ten of them, and the link goes to the patient record, which
            carries the whole history and the notes written on it. */}
        <Card>
          <CardContent className="grid gap-2.5">
            <p className="flex items-baseline justify-between gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              <span>Past visits {history && history.length > 0 ? `(${history.length})` : ''}</span>
              <Link
                href={`/patients/${visit.patient_id}`}
                className="text-xs font-medium tracking-normal text-primary normal-case underline-offset-4 hover:underline"
              >
                Full record
              </Link>
            </p>
            {history === null ? (
              <p className="text-xs text-destructive">
                Could not be loaded. Do not read this as a first visit.
              </p>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                First recorded visit for this patient.
              </p>
            ) : (
              <ul className="grid gap-1.5 text-xs">
                {history.map((past) => (
                  <li
                    key={past.id}
                    className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0 last:pb-0"
                  >
                    <span className="tabular-nums">{formatDate(past.visited_at)}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                      {past.doctor_name ?? past.department_name ?? VISIT_TYPE_LABEL[past.visit_type]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Vitals and notes                                                    */}
      {/* ------------------------------------------------------------------ */}
      <form ref={formRef} action={action} className="grid content-start gap-4 pb-20 lg:pb-0">
        <input type="hidden" name="id" value={recordId} />
        <input type="hidden" name="visit_id" value={visit.id} />

        <FormMessage state={state} />

        {readOnly ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This visit is booked to {visit.doctor_name ?? 'another doctor'}, so it is shown
              read-only. Ask the front desk to reassign it if it should be yours.
            </span>
          </p>
        ) : null}

        <Card>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium">Vitals</h2>
              <p className="text-xs text-muted-foreground">
                Leave a box empty if it was not taken.
              </p>
            </div>

            {/* Two up on a phone, three on a tablet, six across a desk monitor.
                Six vitals in one row is the shape of the paper chart these are
                copied from, so it is the shape a doctor scans fastest. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {VITALS.map((spec, index) => (
                <Field
                  key={spec.key}
                  label={`${spec.label} ${spec.unit}`}
                  htmlFor={spec.key}
                  error={fieldError(state, spec.key)}
                >
                  <Input
                    id={spec.key}
                    name={spec.key}
                    ref={index === 0 ? firstVitalRef : undefined}
                    type="number"
                    inputMode="decimal"
                    step={spec.step}
                    min={spec.min}
                    max={spec.max}
                    placeholder={spec.placeholder}
                    defaultValue={vitalToInput(consultation?.[spec.key])}
                    disabled={readOnly}
                    aria-invalid={fieldError(state, spec.key) !== undefined}
                    className="tabular-nums"
                  />
                </Field>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium">Consultation notes</h2>
              {consultation ? (
                <p className="text-xs text-muted-foreground">
                  Last saved {formatTime(consultation.updated_at)}
                </p>
              ) : null}
            </div>

            <Textarea
              id="notes"
              name="notes"
              ref={notesRef}
              rows={14}
              disabled={readOnly}
              defaultValue={consultation?.notes ?? ''}
              placeholder={
                'Complaint, findings, impression, advice.\n\nFree text for now -- structured history and prescriptions come in a later phase.'
              }
              aria-invalid={fieldError(state, 'notes') !== undefined}
              className="min-h-64 font-mono text-sm leading-relaxed"
            />
            {fieldError(state, 'notes') ? (
              <p className="text-xs font-medium text-destructive">{fieldError(state, 'notes')}</p>
            ) : null}
          </CardContent>
        </Card>

        {/* The prescription.
            Hidden entirely from a role that may not write one -- a nurse
            recording vitals has no use for the rows, and the action refuses
            the list anyway if a POST arrives carrying it. A read-only visit
            still SHOWS what was prescribed: that is the record. */}
        {canPrescribe || prescription.length > 0 ? (
          <Card>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-medium">Prescription</h2>
                {prescription.length > 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/print/prescription/${visit.id}?autoprint=0`}>
                      <PrinterIcon data-icon="inline-start" />
                      Print
                    </Link>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Save the visit, then print
                  </p>
                )}
              </div>

              <PrescriptionEditor
                initial={prescription}
                readOnly={readOnly || !canPrescribe}
              />

              {fieldError(state, 'prescription') ? (
                <p className="text-xs font-medium text-destructive">
                  {fieldError(state, 'prescription')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {readOnly ? null : (
          // Sticky at the bottom of a phone screen: the notes box is taller
          // than the viewport, and a Save button that scrolled off the end of
          // it is a note that never gets saved.
          <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            {/*
              Two submit buttons, each carrying its own name and value: the
              browser puts the one that was pressed into the FormData, so what
              the button MEANS for the queue travels with the click instead of
              being tracked in state alongside it.
            */}
            <SubmitButton
              id="save-consultation"
              name="visit_status"
              // A visit the doctor is clearly working on stops being "waiting"
              // the moment anything is written on it. An already-finished visit
              // keeps its status -- correcting a note must not reopen it.
              value={visit.status === 'waiting' ? 'in_consultation' : ''}
              variant="outline"
              pendingLabel="Saving..."
            >
              {isClosed ? 'Save changes' : 'Save'}
            </SubmitButton>

            {isClosed ? null : (
              <SubmitButton name="visit_status" value="completed" pendingLabel="Completing...">
                Save &amp; complete visit
              </SubmitButton>
            )}

            <span className="ml-auto hidden items-center gap-4 sm:flex">
              <KbdHint keys={['Ctrl', 'S']}>save</KbdHint>
              <KbdHint keys="Esc">back to the queue</KbdHint>
            </span>
          </div>
        )}

        {consultation ? (
          <p className="text-xs text-muted-foreground">
            Record created {formatDateTime(consultation.created_at)}. Edits are kept in the audit
            log; nothing here is deleted.
          </p>
        ) : null}
      </form>
    </div>
  );
}

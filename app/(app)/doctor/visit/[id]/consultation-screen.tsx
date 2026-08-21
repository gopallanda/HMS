'use client';

import { LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { saveConsultationAction, type SaveConsultationState } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE } from '@/lib/action-state';
import { VITALS, vitalToInput, type Consultation } from '@/lib/consultations';
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
 * The consultation screen: who the patient is, what their numbers are, and
 * what the doctor wants to write down.
 *
 * Deliberately three things and no more. Prescriptions and structured history
 * are a later phase (CLAUDE.md 1), and a half-built version of either would be
 * worse than none: staff would start using it and then have to be migrated off
 * it.
 */
export function ConsultationScreen({
  visit,
  history,
  consultation,
  readOnly,
}: {
  visit: ConsultationVisit;
  /** null when the history could not be read -- not the same as "none". */
  history: PastVisit[] | null;
  consultation: Consultation | null;
  readOnly: boolean;
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
    <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* ------------------------------------------------------------------ */}
      {/* Who is in the room                                                  */}
      {/* ------------------------------------------------------------------ */}
      <aside className="grid content-start gap-3">
        <Card>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{visit.patient_name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {visit.patient_mrn}
                </p>
              </div>
              <Badge variant={VISIT_STATUS_VARIANT[visit.status]}>
                {VISIT_STATUS_LABEL[visit.status]}
              </Badge>
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
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
            detail. Opening one is a later phase. */}
        <Card>
          <CardContent className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Past visits {history && history.length > 0 ? `(${history.length})` : ''}
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
                  <li key={past.id} className="flex items-baseline justify-between gap-2">
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
      <form ref={formRef} action={action} className="grid content-start gap-3">
        <input type="hidden" name="id" value={recordId} />
        <input type="hidden" name="visit_id" value={visit.id} />

        <FormMessage state={state} />

        {readOnly ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This visit is booked to {visit.doctor_name ?? 'another doctor'}, so it is shown
              read-only. Ask the front desk to reassign it if it should be yours.
            </span>
          </p>
        ) : null}

        <Card>
          <CardContent className="grid gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Vitals</h2>
              <p className="text-[11px] text-muted-foreground">
                Leave a box empty if it was not taken.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
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
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Consultation notes</h2>
              {consultation ? (
                <p className="text-[11px] text-muted-foreground">
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
              className="min-h-48 font-mono text-sm leading-relaxed"
            />
            {fieldError(state, 'notes') ? (
              <p className="text-xs text-destructive">{fieldError(state, 'notes')}</p>
            ) : null}
          </CardContent>
        </Card>

        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
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

            <p className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
              <kbd className="rounded border px-1">Ctrl</kbd>+
              <kbd className="rounded border px-1">S</kbd> saves,{' '}
              <kbd className="rounded border px-1">Esc</kbd> returns to the queue.
            </p>
          </div>
        )}

        {consultation ? (
          <p className="text-[11px] text-muted-foreground">
            Record created {formatDateTime(consultation.created_at)}. Edits are kept in the audit
            log; nothing here is deleted.
          </p>
        ) : null}
      </form>
    </div>
  );
}

import { ArrowLeftIcon, TicketIcon } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClinicalPanel, type ConsultationVisit, type PatientConsultation } from './clinical-panel';
import { IdentityCard, type PatientIdentity } from './identity-card';
import { MoneyPanel, type PatientInvoice } from './money-panel';
import { PatientActions } from './patient-actions';
import { VisitTimeline, type PatientVisit } from './visit-timeline';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { ageGender } from '@/lib/patients';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/utils/dates';

export const metadata = { title: 'Patient record' };

/** Rows to show in the timeline before offering ?visits=all. A screenful. */
const TIMELINE_LIMIT = 25;

/**
 * How far back the visit read goes at all.
 *
 * The timeline shows 25 of these; the rest are behind "show all". The cap
 * exists because this list is also what gives each consultation note its date,
 * its visit number and its doctor -- so it is read whole once rather than
 * joined per note. A patient with more visits than this keeps every note, with
 * the older ones dated from when they were written.
 */
const VISIT_WINDOW = 200;

/** Notes to read. Deeper than the timeline shows, and still one screenful of scrolling. */
const CONSULTATION_LIMIT = 50;

/**
 * One patient, everything about them.
 *
 * The first screen in the app that crosses module boundaries -- desk, money and
 * clinical data on one page -- and role visibility is not uniform across them.
 * So it is built as sections that OPT IN by role rather than as one query that
 * half-fails:
 *
 *   identity + visits   everyone signed into the hospital
 *   billing             billing.read
 *   consultations       consultation.read
 *
 * The gate is on the QUERY, not only on the markup. consultations_select_clinical
 * would hand a cashier zero rows, and a panel that renders "no consultations"
 * because the reader is not allowed to see them is a lie the screen tells with
 * a straight face (CLAUDE.md 7 -- an absence is not swallowed any more than an
 * error is). The policies remain the real boundary; this decides what is worth
 * asking for.
 */
export default async function PatientRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ visits?: string }>;
}) {
  const { id } = await params;
  const { visits: visitsParam } = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Panel by panel, on permissions rather than on role names (CLAUDE.md 3.6).
  // A custom "Ward sister" holding consultation.read sees the clinical panel
  // and not the money one, which is exactly what the hospital meant when they
  // ticked those boxes -- and is unreachable with a switch on app_role.
  const held = session.access.permissions;
  const canSeeMoney = held.has('billing.read');
  const canSeeClinical = held.has('consultation.read');
  const canEdit = held.has('patients.update');
  const canRemove = held.has('patients.update');

  const [patientResult, visitResult, invoiceResult, consultationResult] = await Promise.all([
    supabase
      .from('patients')
      .select('id, mrn, full_name, dob, gender, phone, address, created_at, deleted_at')
      .eq('hospital_id', session.hospitalId)
      .eq('id', id)
      .maybeSingle(),

    supabase
      .from('visit_queue')
      .select(
        'id, visit_no, token_no, visit_type, status, visited_at, doctor_name, department_name, charge_total',
      )
      .eq('hospital_id', session.hospitalId)
      .eq('patient_id', id)
      .order('visited_at', { ascending: false })
      .limit(VISIT_WINDOW),

    canSeeMoney
      ? supabase
          .from('invoice_summary')
          .select(
            'id, invoice_no, invoice_date, status, grand_total, paid_total, balance, visit_no, token_no',
          )
          .eq('hospital_id', session.hospitalId)
          .eq('patient_id', id)
          .order('invoice_date', { ascending: false })
      : null,

    canSeeClinical
      ? supabase
          .from('consultations')
          .select(
            'id, visit_id, created_at, updated_at, notes, bp_systolic, bp_diastolic, pulse, temperature_f, weight_kg, spo2',
          )
          .eq('hospital_id', session.hospitalId)
          .eq('patient_id', id)
          .order('created_at', { ascending: false })
          .limit(CONSULTATION_LIMIT)
      : null,
  ]);

  // The patient is the page. If that one read failed there is nothing to hang
  // the sections on, so this is the only failure that takes the screen with it.
  if (patientResult.error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Patient record" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          This patient could not be loaded: {patientResult.error.message}
        </p>
      </div>
    );
  }

  // Not found, or found in another hospital -- which RLS has already turned
  // into not found, the same as the doctor's visit page.
  if (!patientResult.data) notFound();

  const patient: PatientIdentity = patientResult.data;
  const removed = patient.deleted_at !== null;

  const visits: PatientVisit[] | null = visitResult.error ? null : (visitResult.data ?? []);
  const invoices: PatientInvoice[] | null =
    invoiceResult === null || invoiceResult.error ? null : (invoiceResult.data ?? []);
  const consultations: PatientConsultation[] | null =
    consultationResult === null || consultationResult.error
      ? null
      : (consultationResult.data ?? []);

  /** visit_id -> visit, so a note can print the date and doctor of its visit. */
  const visitsById = new Map<string, ConsultationVisit>(
    (visits ?? []).map((visit) => [
      visit.id,
      {
        visit_no: visit.visit_no,
        visited_at: visit.visited_at,
        doctor_name: visit.doctor_name,
      },
    ]),
  );

  const shown = visitsParam === 'all' ? VISIT_WINDOW : TIMELINE_LIMIT;

  return (
    <div className="grid gap-5">
      <PageHeader
        title={patient.full_name}
        description={[
          patient.mrn,
          ageGender(patient.dob, patient.gender),
          patient.phone ?? 'No phone',
        ].join(' · ')}
        actions={
          <>
            <Button asChild variant="ghost" size="icon" aria-label="Back to patient search">
              <Link href="/patients">
                <ArrowLeftIcon />
              </Link>
            </Button>

            {canEdit && !removed ? (
              <Button asChild>
                <Link href={`/front-desk/register?patient=${patient.id}`}>
                  <TicketIcon data-icon="inline-start" />
                  New visit
                </Link>
              </Button>
            ) : null}

            <PatientActions
              patient={patient}
              canEdit={canEdit}
              canRemove={canRemove}
            />
          </>
        }
      />

      {/*
        A removed record is shown, not hidden behind a 404. Somebody followed a
        link from an old invoice or an old visit for a reason, and the history
        under it is still true (CLAUDE.md 3.3 -- soft delete, never a delete).
        What it loses is the buttons: no new visit, no corrections.
      */}
      {removed ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning dark:bg-warning/15">
          <strong className="font-semibold">This record was removed</strong> on{' '}
          {formatDateTime(patient.deleted_at!)}. It no longer appears in search and cannot start a
          new visit. Everything below still happened and still counts.
          {canRemove ? ' Restore it if it was removed by mistake.' : ''}
        </p>
      ) : null}

      <IdentityCard patient={patient} />

      {/*
        Billing sits above the history on purpose. The cashier's question --
        "what does this patient still owe" -- is the one with somebody standing
        at a counter waiting for the answer, and a doctor never sees this panel
        at all, so nothing is pushed down for them.
      */}
      {canSeeMoney ? (
        <MoneyPanel invoices={invoices} error={invoiceResult?.error?.message} />
      ) : null}

      <VisitTimeline
        visits={visits}
        error={visitResult.error?.message}
        shown={shown}
        clinical={canSeeClinical}
      />

      {canSeeClinical ? (
        <ClinicalPanel
          consultations={consultations}
          visits={visitsById}
          error={consultationResult?.error?.message}
        />
      ) : null}
    </div>
  );
}

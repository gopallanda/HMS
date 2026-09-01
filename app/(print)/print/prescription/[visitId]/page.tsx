import { notFound } from 'next/navigation';

import type { PrescriptionDocument } from './document';
import { PrescriptionSheet } from './prescription-sheet';
import { PrintAudit } from './print-audit';
import { PrintLayout } from '@/components/shared/print-layout';
import { AccessDenied } from '@/components/shell/access-denied';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { isPrintFormat, type PrintFormat } from '@/lib/billing';
import { toPrescriptionLines } from '@/lib/consultations';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Prescription' };

/**
 * Which papers a prescription offers.
 *
 * A5 and A4 only. 80mm is the roll bolted to the billing counter, and a drug
 * list printed on a till receipt is not something a patient can hand to a
 * pharmacist -- it curls, it fades, and there is nowhere to sign.
 */
const PRESCRIPTION_FORMATS: readonly PrintFormat[] = ['a5', 'a4'];

/**
 * The prescription, on paper (item 7).
 *
 * Follows /print/receipt/[invoiceId] exactly: the same PrintLayout, the same
 * `?format=` and `?autoprint=0` query, the same afterprint audit hook. Two
 * print routes that behaved differently would be two sets of printer
 * instructions for staff to learn.
 *
 * A5 is the default rather than the hospital's receipt_default: that setting
 * is about the RECEIPT paper at the counter, and a prescription is a different
 * document going to a different printer. Half a sheet is what an OPD hands
 * over.
 *
 * consultation.read, not prescription.create. Reception prints the script the
 * doctor already wrote; requiring the write permission to reprint it would
 * mean only the doctor could hand a patient another copy.
 */
export default async function PrescriptionPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ format?: string; autoprint?: string }>;
}) {
  const session = await requireSession();
  const { visitId } = await params;
  const { format: requested, autoprint } = await searchParams;

  if (!session.access.permissions.has('consultation.read')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="Prescriptions"
        audience="clinical staff"
      />
    );
  }

  const supabase = await createClient();

  // The visit carries the patient and the doctor; the consultation carries the
  // script. Both go through RLS -- consultations_select_clinical is narrower
  // than the visit policies, which is exactly why the permission check above
  // names consultation.read.
  const [visitResult, consultationResult] = await Promise.all([
    supabase
      .from('visit_queue')
      .select(
        'id, visit_no, token_no, visited_at, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, doctor_id, doctor_name, department_name',
      )
      .eq('hospital_id', session.hospitalId)
      .eq('id', visitId)
      .maybeSingle(),
    supabase
      .from('consultations')
      .select(
        'prescription, notes, bp_systolic, bp_diastolic, pulse, temperature_f, weight_kg, spo2, updated_at',
      )
      .eq('hospital_id', session.hospitalId)
      .eq('visit_id', visitId)
      .maybeSingle(),
  ]);

  if (visitResult.error || !visitResult.data) notFound();
  const visit = visitResult.data;

  // The registration number is a separate read: visit_queue carries the
  // doctor's NAME because a queue board needs it, and reg_no belongs to the
  // staff record. It is required on an Indian prescription, so it is fetched
  // rather than left off.
  const { data: doctor } = visit.doctor_id
    ? await supabase
        .from('staff')
        .select('full_name, reg_no')
        .eq('hospital_id', session.hospitalId)
        .eq('id', visit.doctor_id)
        .maybeSingle()
    : { data: null };

  const consultation = consultationResult.data;

  const document: PrescriptionDocument = {
    // From the hospitals row, never hardcoded (CLAUDE.md 7).
    hospital: {
      name: session.hospital.name,
      logo_url: session.hospital.logo_url,
      address: session.hospital.address,
      phone: session.hospital.phone,
      gstin: session.hospital.gstin,
    },
    visit: {
      id: visit.id,
      visit_no: visit.visit_no,
      token_no: visit.token_no,
      visited_at: visit.visited_at,
    },
    patient: {
      full_name: visit.patient_name,
      mrn: visit.patient_mrn,
      dob: visit.patient_dob,
      gender: visit.patient_gender,
      phone: visit.patient_phone,
    },
    doctor: {
      full_name: doctor?.full_name ?? visit.doctor_name,
      reg_no: doctor?.reg_no ?? null,
      department_name: visit.department_name,
    },
    vitals: {
      bp_systolic: consultation?.bp_systolic ?? null,
      bp_diastolic: consultation?.bp_diastolic ?? null,
      pulse: consultation?.pulse ?? null,
      temperature_f: consultation?.temperature_f ?? null,
      weight_kg: consultation?.weight_kg ?? null,
      spo2: consultation?.spo2 ?? null,
    },
    lines: toPrescriptionLines(consultation?.prescription),
    notes: consultation?.notes ?? null,
    // When the script was last written, not when it is being printed. A
    // reprint in the evening is still that morning's prescription.
    written_at: consultation?.updated_at ?? visit.visited_at,
  };

  const format: PrintFormat =
    isPrintFormat(requested) && PRESCRIPTION_FORMATS.includes(requested) ? requested : 'a5';

  return (
    <PrintLayout
      format={format}
      autoPrint={autoprint !== '0'}
      backHref={`/doctor/visit/${visitId}`}
      documentHref={`/print/prescription/${visitId}`}
      formats={PRESCRIPTION_FORMATS}
      title={`Prescription - ${document.patient.full_name} - ${document.visit.visit_no}`}
    >
      <PrintAudit visitId={visitId} format={format} />
      <PrescriptionSheet document={document} />
    </PrintLayout>
  );
}

import { NotebookPenIcon } from 'lucide-react';
import Link from 'next/link';

import { SectionCard, SectionError } from './section';
import { EmptyState } from '@/components/shared/empty-state';
import { summariseVitals, type Consultation } from '@/lib/consultations';
import { formatDate, formatDateTime } from '@/lib/utils/dates';

export type PatientConsultation = Pick<
  Consultation,
  | 'id'
  | 'visit_id'
  | 'created_at'
  | 'updated_at'
  | 'notes'
  | 'bp_systolic'
  | 'bp_diastolic'
  | 'pulse'
  | 'temperature_f'
  | 'weight_kg'
  | 'spo2'
>;

/** What the visit list already knows about the visit a note was written on. */
export type ConsultationVisit = {
  visit_no: string;
  visited_at: string;
  doctor_name: string | null;
};

/**
 * Vitals and notes, newest first.
 *
 * Rendered only for clinical roles, and the query is not issued at all for
 * anyone else. That is a deliberate choice rather than an accident of RLS:
 * consultations_select_clinical would hand a cashier zero rows, and an empty
 * panel reading "no consultations" on a patient who has been seen four times
 * is a lie the screen tells with a straight face. CLAUDE.md 7 says an error is
 * never swallowed; the same applies to an absence.
 */
export function ClinicalPanel({
  consultations,
  visits,
  error,
}: {
  /** null when the read failed -- not the same as "nothing was written". */
  consultations: PatientConsultation[] | null;
  /** visit_id -> the visit it belongs to, from the timeline's own read. */
  visits: Map<string, ConsultationVisit>;
  error?: string;
}) {
  if (consultations === null) {
    return (
      <SectionCard id="clinical" title="Consultations">
        <SectionError>
          The consultation notes could not be read. This patient may well have a history — this
          screen simply does not know it. {error}
        </SectionError>
      </SectionCard>
    );
  }

  return (
    <SectionCard id="clinical" title="Consultations" count={consultations.length}>
      {consultations.length === 0 ? (
        <EmptyState
          compact
          icon={NotebookPenIcon}
          title="No notes recorded"
          description="Vitals and notes are written on the visit, from the doctor's queue."
        />
      ) : (
        <ol className="grid gap-3">
          {consultations.map((consultation) => {
            const visit = visits.get(consultation.visit_id);
            const vitals = summariseVitals(consultation);

            return (
              <li
                key={consultation.id}
                className="rounded-lg border border-border/60 px-3 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">
                    {/* Falls back to when the note was written. A visit older
                        than this screen's window is still a real note, and
                        dropping the date would be worse than approximating it. */}
                    {formatDate(visit?.visited_at ?? consultation.created_at)}
                    {visit ? (
                      <Link
                        href={`/doctor/visit/${consultation.visit_id}`}
                        className="ml-2 font-mono text-xs font-normal text-primary underline-offset-4 hover:underline"
                      >
                        {visit.visit_no}
                      </Link>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {visit?.doctor_name ?? 'Doctor not recorded'}
                  </span>
                </div>

                {vitals.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {vitals.map((vital) => (
                      <span key={vital.label} className="text-muted-foreground">
                        {vital.label}{' '}
                        <span className="font-medium text-foreground tabular-nums">
                          {vital.value}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No vitals taken.</p>
                )}

                {consultation.notes ? (
                  // whitespace-pre-line: the notes box is free text and doctors
                  // use line breaks as structure. Collapsing them turns four
                  // findings into one paragraph.
                  <p className="mt-2 border-t border-border/60 pt-2 text-sm whitespace-pre-line">
                    {consultation.notes}
                  </p>
                ) : null}

                {consultation.updated_at !== consultation.created_at ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Edited {formatDateTime(consultation.updated_at)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

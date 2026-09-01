import type { PrescriptionDocument } from './document';
import { formatAge } from '@/lib/utils/age-from-dob';
import { formatDate, formatTime } from '@/lib/utils/dates';

/**
 * The doctor's name as it should read on paper.
 *
 * staff.full_name is entered by an administrator and in this hospital's own
 * seed data it already reads "Dr. Anjali Rao". Prefixing unconditionally
 * prints "Dr Dr. Anjali Rao" on the one document a patient carries to a
 * pharmacy, so the prefix is added only when it is not already there.
 */
function doctorName(name: string | null): string {
  if (name === null) return 'Doctor not recorded';
  const trimmed = name.trim();
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr ${trimmed}`;
}

const GENDER_SHORT: Record<'male' | 'female' | 'other', string> = {
  male: 'M',
  female: 'F',
  other: 'O',
};

/**
 * The prescription, on paper.
 *
 * ONE template for both A5 and A4: the difference is the sheet it lands on,
 * not the document. A prescription is a list of drugs with a signature under
 * it, and half a sheet holds that as well as a whole one does.
 *
 * Black on white, like the receipt and for a related reason (CLAUDE.md 7): no
 * colour, no background fills, no box shadows. This one is not going to a
 * thermal head, but it IS going to whatever ten-year-old laser printer the
 * clinic owns, and it will be photocopied by a pharmacist. Grey fills
 * photocopy as smudges.
 *
 * Nothing here interprets a line. The drug, the strength, the dose, the
 * frequency and the duration print exactly as the doctor typed them -- there
 * is no drug master to check them against and pretending otherwise on the one
 * document a patient carries away would be worse than useless.
 */
export function PrescriptionSheet({ document }: { document: PrescriptionDocument }) {
  const { hospital, visit, patient, doctor, vitals, lines, notes } = document;

  const bp =
    vitals.bp_systolic !== null && vitals.bp_diastolic !== null
      ? `${vitals.bp_systolic}/${vitals.bp_diastolic}`
      : null;

  const vitalStrip = [
    bp ? `BP ${bp}` : null,
    vitals.pulse !== null ? `Pulse ${vitals.pulse}` : null,
    vitals.temperature_f !== null ? `Temp ${vitals.temperature_f} F` : null,
    vitals.spo2 !== null ? `SpO2 ${vitals.spo2}%` : null,
    vitals.weight_kg !== null ? `Wt ${vitals.weight_kg} kg` : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    <>
      {/* The letterhead, from the hospitals row and never hardcoded. */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, textTransform: 'uppercase' }}>
          {hospital.name}
        </div>
        {hospital.address ? <div style={{ fontSize: '11px' }}>{hospital.address}</div> : null}
        {hospital.phone ? <div style={{ fontSize: '11px' }}>Ph {hospital.phone}</div> : null}
      </div>

      <div className="solid" />

      {/* Who wrote it. The registration number is a legal requirement on an
          Indian prescription, so the label prints even when the staff record
          has no number on it -- a visible blank gets asked about. */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm', fontSize: '11px' }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>{doctorName(doctor.full_name)}</div>
          {doctor.department_name ? <div>{doctor.department_name}</div> : null}
          <div>Reg. No. {doctor.reg_no ?? '__________'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div>{formatDate(document.written_at)}</div>
          <div>{formatTime(document.written_at)}</div>
          <div>
            {visit.visit_no} &middot; token {visit.token_no}
          </div>
        </div>
      </div>

      <div className="rule" />

      {/* Who it is for. Age and sex are on the same line as the name, the way
          they are on a paper pad -- a pharmacist checks all three at once. */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm', fontSize: '11px' }}
      >
        <div>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{patient.full_name}</span>
          <span>
            {'  '}
            {formatAge(patient.dob)} / {GENDER_SHORT[patient.gender]}
          </span>
          <div>
            {patient.mrn}
            {patient.phone ? ` · ${patient.phone}` : ''}
          </div>
        </div>
        {vitalStrip.length > 0 ? (
          <div style={{ textAlign: 'right' }}>{vitalStrip.join('   ')}</div>
        ) : null}
      </div>

      <div className="solid" />

      {/* The Rx symbol, because a prescription that does not carry it does not
          read as one to anybody who handles them all day. */}
      <div style={{ fontSize: '22px', fontWeight: 700, margin: '1mm 0 2mm' }}>&#8478;</div>

      {lines.length === 0 ? (
        <div style={{ fontStyle: 'italic' }}>No drugs prescribed at this visit.</div>
      ) : (
        <table>
          <thead>
            <tr style={{ borderBottom: '1px solid #000' }}>
              <th style={{ textAlign: 'left', width: '8mm', padding: '1mm 0' }}>#</th>
              <th style={{ textAlign: 'left', padding: '1mm 0' }}>Drug</th>
              <th style={{ textAlign: 'left', width: '22mm', padding: '1mm 0' }}>Dose</th>
              <th style={{ textAlign: 'left', width: '22mm', padding: '1mm 0' }}>Frequency</th>
              <th style={{ textAlign: 'left', width: '24mm', padding: '1mm 0' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.drug}-${index}`} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '1.5mm 0' }}>{index + 1}.</td>
                <td style={{ padding: '1.5mm 0' }}>
                  <span style={{ fontWeight: 700 }}>{line.drug}</span>
                  {line.strength ? ` ${line.strength}` : ''}
                  {line.notes ? (
                    <div style={{ fontSize: '10px' }}>{line.notes}</div>
                  ) : null}
                </td>
                <td style={{ padding: '1.5mm 0' }}>{line.dose ?? '-'}</td>
                <td style={{ padding: '1.5mm 0' }}>{line.frequency ?? '-'}</td>
                <td style={{ padding: '1.5mm 0' }}>{line.duration ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {notes ? (
        <>
          <div className="rule" />
          <div style={{ fontSize: '11px' }}>
            <div style={{ fontWeight: 700 }}>Advice</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{notes}</div>
          </div>
        </>
      ) : null}

      {/* The signature line. A prescription without somewhere to sign is not a
          prescription; the pharmacist will not accept it. */}
      <div style={{ marginTop: '18mm', display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: '60mm', textAlign: 'center', fontSize: '11px' }}>
          <div style={{ borderTop: '1px solid #000', paddingTop: '1.5mm' }}>
            {doctor.full_name === null ? 'Signature' : doctorName(doctor.full_name)}
          </div>
          <div style={{ fontSize: '10px' }}>Reg. No. {doctor.reg_no ?? '__________'}</div>
        </div>
      </div>

      <div className="rule" />

      <div style={{ fontSize: '10px', textAlign: 'center' }}>
        Not valid for medico-legal purposes without the treating doctor&apos;s signature.
      </div>
    </>
  );
}

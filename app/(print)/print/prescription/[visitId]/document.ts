import type { PrescriptionLine } from '@/lib/consultations';

/**
 * Everything a printed prescription needs.
 *
 * Its own module for the same reason the receipt's is: both the template and
 * the page import it, and a type exported from a `page.tsx` drags the whole
 * route into anything that touches it.
 *
 * Nothing here is computed downstream. The lines are what the doctor wrote,
 * the doctor's name and registration number are what the staff row says, and
 * the hospital block comes from the hospitals row rather than being hardcoded
 * (CLAUDE.md 7).
 */
export type PrescriptionDocument = {
  hospital: {
    name: string;
    logo_url: string | null;
    address: string | null;
    phone: string | null;
    gstin: string | null;
  };
  visit: {
    id: string;
    visit_no: string;
    token_no: number;
    visited_at: string;
  };
  patient: {
    full_name: string;
    mrn: string;
    dob: string;
    gender: 'male' | 'female' | 'other';
    phone: string | null;
  };
  doctor: {
    full_name: string | null;
    /**
     * The medical council registration number.
     *
     * Required on a prescription in India, and null here when the staff record
     * has not been given one. The sheet prints the label with nothing after it
     * rather than hiding the line: a blank where the number belongs is a
     * question somebody asks, and a missing line is one nobody notices.
     */
    reg_no: string | null;
    department_name: string | null;
  };
  /** Vitals, for the header strip. Every one of them is optional. */
  vitals: {
    bp_systolic: number | null;
    bp_diastolic: number | null;
    pulse: number | null;
    temperature_f: number | null;
    weight_kg: number | null;
    spo2: number | null;
  };
  lines: PrescriptionLine[];
  notes: string | null;
  written_at: string;
};

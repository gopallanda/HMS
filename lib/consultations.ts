/**
 * Consultations.
 *
 * The vitals are described once, here, and the form, the summary line and the
 * schema all read that description. A seventh vital in a later phase is one
 * entry in VITALS plus one column, not an edit in four files that have to
 * agree with each other.
 *
 * Ranges match the CHECK constraints in 20260820120000_consultations.sql on
 * purpose. They are typo guards, not clinical opinions: they reject 1200 for a
 * pulse and accept everything a real patient can present with.
 */

import type { Database } from '@/types/database';

export type Consultation = Database['public']['Tables']['consultations']['Row'];

/** The six numbers on the form, as they arrive from and go back to the RPC. */
export type Vitals = Pick<
  Consultation,
  'bp_systolic' | 'bp_diastolic' | 'pulse' | 'temperature_f' | 'weight_kg' | 'spo2'
>;

export type VitalKey = keyof Vitals;

export type VitalSpec = {
  key: VitalKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Decimal places the input accepts. 0 means whole numbers only. */
  step: number;
  /** Greyed-out example, so nobody has to guess the unit or the scale. */
  placeholder: string;
};

export const VITALS: readonly VitalSpec[] = [
  {
    key: 'bp_systolic',
    label: 'BP systolic',
    unit: 'mmHg',
    min: 50,
    max: 300,
    step: 1,
    placeholder: '120',
  },
  {
    key: 'bp_diastolic',
    label: 'BP diastolic',
    unit: 'mmHg',
    min: 20,
    max: 200,
    step: 1,
    placeholder: '80',
  },
  { key: 'pulse', label: 'Pulse', unit: '/min', min: 20, max: 250, step: 1, placeholder: '78' },
  {
    key: 'temperature_f',
    // Fahrenheit, because that is what the chart in the room is written in.
    label: 'Temp',
    unit: '°F',
    min: 90,
    max: 110,
    step: 0.1,
    placeholder: '98.6',
  },
  {
    key: 'weight_kg',
    label: 'Weight',
    unit: 'kg',
    min: 0.5,
    max: 400,
    step: 0.01,
    placeholder: '68',
  },
  { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, step: 1, placeholder: '98' },
];

export const EMPTY_VITALS: Vitals = {
  bp_systolic: null,
  bp_diastolic: null,
  pulse: null,
  temperature_f: null,
  weight_kg: null,
  spo2: null,
};

/**
 * "120/80" -- the only vital that is a pair. The database refuses half of one
 * (consultations_bp_is_a_pair), so this never has to render "120/".
 */
export function formatBp(vitals: Pick<Vitals, 'bp_systolic' | 'bp_diastolic'>): string | null {
  if (vitals.bp_systolic === null || vitals.bp_diastolic === null) return null;
  return `${vitals.bp_systolic}/${vitals.bp_diastolic}`;
}

/**
 * The vitals as a doctor would read them out, skipping the ones nobody took:
 * "BP 120/80 - Pulse 78/min - Temp 98.6F - SpO2 98%".
 *
 * Returns an empty array rather than a placeholder string, so the caller
 * decides what "no vitals recorded" looks like in its own layout.
 */
export function summariseVitals(vitals: Vitals): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];

  const bp = formatBp(vitals);
  if (bp) out.push({ label: 'BP', value: `${bp} mmHg` });

  for (const spec of VITALS) {
    if (spec.key === 'bp_systolic' || spec.key === 'bp_diastolic') continue;
    const value = vitals[spec.key];
    if (value === null || value === undefined) continue;
    out.push({ label: spec.label, value: `${value} ${spec.unit}` });
  }

  return out;
}

export function hasVitals(vitals: Vitals): boolean {
  return VITALS.some((spec) => vitals[spec.key] !== null && vitals[spec.key] !== undefined);
}

/** What the form shows in a number input: the value, or an empty box. */
export function vitalToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

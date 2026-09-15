/**
 * The New vs Return report.
 *
 * Takes the Supabase client as an argument, like the rest of this directory.
 * The RPC returns one flat table with a `bucket` discriminator -- summary,
 * doctor, week -- and this module splits it back apart. The definitions of
 * "new", "came back" and "matured" live in one place, in SQL
 * (patient_mix_visits, 20260915090000); nothing here recomputes them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { shiftIstDay } from '@/lib/utils/dates';
import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

export type PatientMixRow =
  Database['public']['Functions']['patient_mix_report']['Returns'][number];

export type LostPatientRow =
  Database['public']['Functions']['patient_mix_lost_patients']['Returns'][number];

export type MixCounts = {
  visits: number;
  patients: number;
  /** The patient's first visit to this hospital. */
  newToHospital: number;
  /** Known to the hospital, first time with this doctor. */
  newToDoctor: number;
  /** Seen by this doctor before. */
  repeatVisits: number;
};

export type MixSummary = MixCounts & {
  /** New patients whose window has fully passed. */
  cohortMatured: number;
  /** Of those, how many came back to anybody within the window. */
  cameBack: number;
  medianGapDays: number | null;
};

export type MixDoctor = MixCounts & {
  doctorId: string;
  doctorName: string;
  departmentName: string | null;
  /** Everybody seeing this doctor for the first time in the range. */
  cohort: number;
  cohortMatured: number;
  cameBack: number;
  wentElsewhere: number;
  medianGapDays: number | null;
};

export type MixWeek = MixCounts & { weekStart: string };

export function patientMixReport(
  supabase: Client,
  hospitalId: string,
  from: string,
  to: string,
  windowDays: number,
) {
  return supabase.rpc('patient_mix_report', {
    p_hospital_id: hospitalId,
    p_from: from,
    p_to: to,
    p_window_days: windowDays,
  });
}

export function patientMixLostPatients(
  supabase: Client,
  hospitalId: string,
  doctorId: string,
  from: string,
  to: string,
  windowDays: number,
  limit = 200,
) {
  return supabase.rpc('patient_mix_lost_patients', {
    p_doctor_id: doctorId,
    p_hospital_id: hospitalId,
    p_from: from,
    p_to: to,
    p_window_days: windowDays,
    p_limit: limit,
  });
}

/** Whole percent, or null when there is nothing to take a percentage of. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

const ZERO: MixCounts = {
  visits: 0,
  patients: 0,
  newToHospital: 0,
  newToDoctor: 0,
  repeatVisits: 0,
};

function countsOf(row: PatientMixRow): MixCounts {
  return {
    visits: Number(row.visit_count ?? 0),
    patients: Number(row.patient_count ?? 0),
    newToHospital: Number(row.new_to_hospital ?? 0),
    newToDoctor: Number(row.new_to_doctor ?? 0),
    repeatVisits: Number(row.repeat_visits ?? 0),
  };
}

function numberOrNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/** The Monday of an ISO day -- Postgres date_trunc('week') agrees. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftIstDay(day, -((weekday + 6) % 7));
}

/**
 * Splits the flat result into what the screen shows.
 *
 * Weeks with no visits are filled in as zeros between the range's first and
 * last Monday. The RPC only returns weeks that had somebody in them, and a
 * chart that silently closes the gap over a week the clinic was shut draws a
 * trend that did not happen.
 */
export function groupPatientMix(rows: PatientMixRow[], from: string, to: string) {
  let summary: MixSummary = { ...ZERO, cohortMatured: 0, cameBack: 0, medianGapDays: null };
  const doctors: MixDoctor[] = [];
  const byWeek = new Map<string, MixWeek>();

  for (const row of rows) {
    if (row.bucket === 'summary') {
      summary = {
        ...countsOf(row),
        cohortMatured: Number(row.cohort_matured ?? 0),
        cameBack: Number(row.came_back ?? 0),
        medianGapDays: numberOrNull(row.median_gap_days),
      };
    } else if (row.bucket === 'doctor' && row.doctor_id) {
      doctors.push({
        ...countsOf(row),
        doctorId: row.doctor_id,
        doctorName: row.doctor_name ?? 'Unknown doctor',
        departmentName: row.department_name,
        cohort: Number(row.cohort ?? 0),
        cohortMatured: Number(row.cohort_matured ?? 0),
        cameBack: Number(row.came_back ?? 0),
        wentElsewhere: Number(row.went_elsewhere ?? 0),
        medianGapDays: numberOrNull(row.median_gap_days),
      });
    } else if (row.bucket === 'week' && row.week_start) {
      byWeek.set(row.week_start, { ...countsOf(row), weekStart: row.week_start });
    }
  }

  const weeks: MixWeek[] = [];
  for (let week = mondayOf(from); week <= to; week = shiftIstDay(week, 7)) {
    weeks.push(byWeek.get(week) ?? { ...ZERO, weekStart: week });
  }

  // Grouped by department, because that is the only comparison that means
  // anything: a GP and a diabetologist should not have the same return rate.
  // UNION ALL promises no order, so it is imposed here.
  doctors.sort(
    (a, b) =>
      (a.departmentName ?? '￿').localeCompare(b.departmentName ?? '￿') ||
      b.visits - a.visits ||
      a.doctorName.localeCompare(b.doctorName),
  );

  return { summary, doctors, weeks };
}

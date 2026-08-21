/**
 * Visits.
 *
 * Labels and display rules for the two visit enums, kept together so the
 * register screen, the queue and (later) the doctor screen all say the same
 * words for the same state.
 *
 * IPD is deliberately absent from VISIT_TYPES_AT_DESK. The enum carries it,
 * because an admission IS a visit and the column would otherwise need a
 * migration in Phase 3 -- but a bed, an admission and daily charge accrual are
 * not built, so the front desk is not offered a door into half a feature
 * (CLAUDE.md 1).
 */

import type { Database } from '@/types/database';

export type VisitType = Database['public']['Enums']['visit_type'];
export type VisitStatus = Database['public']['Enums']['visit_status'];

export const VISIT_TYPES = ['opd', 'ipd', 'emergency'] as const satisfies readonly VisitType[];

/** What the register screen offers today. IPD arrives with Phase 3. */
export const VISIT_TYPES_AT_DESK = ['opd', 'emergency'] as const satisfies readonly VisitType[];

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  opd: 'OPD',
  ipd: 'IPD',
  emergency: 'Emergency',
};

export const VISIT_STATUSES = [
  'waiting',
  'in_consultation',
  'completed',
  'cancelled',
] as const satisfies readonly VisitStatus[];

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  waiting: 'Waiting',
  in_consultation: 'With doctor',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Badge variant per status. Waiting is the loud one on purpose: it is the only
 * state that needs somebody to do something.
 */
export const VISIT_STATUS_VARIANT: Record<
  VisitStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  waiting: 'default',
  in_consultation: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
};

/** Statuses that still count as being in today's queue. */
export function isOpenStatus(status: VisitStatus): boolean {
  return status === 'waiting' || status === 'in_consultation';
}

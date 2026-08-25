/**
 * Tenant lifecycle: is this hospital still allowed to work, and for how long.
 *
 * The authority is Postgres -- public.hospital_lifecycle_state() and the BEFORE
 * INSERT triggers it feeds (20260825140000). Nothing here is a security
 * boundary; a suspended tenant that got past this file still cannot write a
 * row. What these functions buy is a banner at the top of the screen and a
 * sentence in the failed action, instead of a raw database error at the end of
 * a registration the user has already typed.
 *
 * The rule is duplicated rather than fetched because the hospital row is
 * already in hand on every request (getSession reads it for the shell's
 * branding), so asking the database again would be a second round trip to
 * re-derive something the row already states.
 */

import type { Database } from '@/types/database';

/** Mirrors the return values of public.hospital_lifecycle_state(). */
export type HospitalLifecycleState = 'active' | 'suspended' | 'trial_expired';

/** The lifecycle columns, so callers can pass a whole hospital row or a slice. */
export type HospitalLifecycle = Pick<
  Database['public']['Tables']['hospitals']['Row'],
  'plan' | 'status' | 'trial_ends_at' | 'suspension_reason'
>;

/**
 * What state the tenant is in.
 *
 * 'missing' has no counterpart here: a caller holding a hospital row has one by
 * definition, and getSession reports that case separately as hospital_missing.
 */
export function lifecycleState(
  hospital: HospitalLifecycle,
  now: Date = new Date(),
): HospitalLifecycleState {
  if (hospital.status === 'suspended') return 'suspended';
  if (isTrialExpired(hospital, now)) return 'trial_expired';
  return 'active';
}

/**
 * A trial with no end date never expires. That is not an oversight: hospitals
 * created before lifecycle tracking carry a null there, and a null that meant
 * "expired" would lock out every tenant the moment the migration landed.
 */
export function isTrialExpired(
  hospital: HospitalLifecycle,
  now: Date = new Date(),
): boolean {
  if (hospital.plan !== 'trial' || !hospital.trial_ends_at) return false;
  return new Date(hospital.trial_ends_at).getTime() <= now.getTime();
}

/**
 * Whole days left in the trial, or null when the tenant is not on a trial that
 * ends. Rounds up, so the last part-day still reads as "1 day left" rather than
 * "0 days left" while the hospital is demonstrably still working.
 */
export function trialDaysRemaining(
  hospital: HospitalLifecycle,
  now: Date = new Date(),
): number | null {
  if (hospital.plan !== 'trial' || !hospital.trial_ends_at) return null;
  const ms = new Date(hospital.trial_ends_at).getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * How close to the end of a trial the app starts saying so. A week is long
 * enough that an administrator can get a decision through whoever signs the
 * cheques, and short enough that the banner is not permanent furniture.
 */
export const TRIAL_WARNING_DAYS = 7;

export function shouldWarnAboutTrial(
  hospital: HospitalLifecycle,
  now: Date = new Date(),
): boolean {
  const days = trialDaysRemaining(hospital, now);
  return days !== null && days > 0 && days <= TRIAL_WARNING_DAYS;
}

import { PauseCircleIcon, TimerIcon, TimerOffIcon } from 'lucide-react';

import {
  shouldWarnAboutTrial,
  trialDaysRemaining,
  type HospitalLifecycle,
  type HospitalLifecycleState,
} from '@/lib/hospital-lifecycle';
import { isAdminRole, type AppRole } from '@/lib/roles';
import { formatDate } from '@/lib/utils/dates';

/**
 * What the tenant's commercial state means for the person on shift.
 *
 * Three cases, one strip:
 *   suspended / trial_expired -- writes are already being refused by the
 *     database (20260825140000). Say so at the top of every screen, because
 *     the alternative is finding out at the counter, halfway through a
 *     registration, with someone waiting.
 *   trial ending soon -- a week's notice, administrators only.
 *
 * Nothing here blocks anything. A suspended hospital is read-only, not locked
 * out: patient records, histories and past invoices stay reachable, and the
 * refusal happens at the write.
 */
export function LifecycleBanner({
  hospital,
  lifecycle,
  role,
}: {
  hospital: HospitalLifecycle;
  lifecycle: HospitalLifecycleState;
  role: AppRole;
}) {
  if (lifecycle === 'suspended') {
    return (
      <Strip icon={<PauseCircleIcon className="size-4 shrink-0" />}>
        <span className="font-medium">
          This hospital is suspended. Nothing new can be saved.
        </span>
        <span className="text-muted-foreground">
          {/* The reason is typed by whoever suspends the tenant, in the same
              spirit as invoices.void_reason: a hospital told only "suspended"
              does not know who to call or what to fix. */}
          {hospital.suspension_reason ? `${hospital.suspension_reason} ` : ''}
          Patients, visits and invoices already recorded can still be opened and printed. Contact
          support to have this lifted.
        </span>
      </Strip>
    );
  }

  if (lifecycle === 'trial_expired') {
    return (
      <Strip icon={<TimerOffIcon className="size-4 shrink-0" />}>
        <span className="font-medium">
          Your trial has ended{hospital.trial_ends_at ? ` (${formatDate(hospital.trial_ends_at)})` : ''}.
          Nothing new can be saved.
        </span>
        <span className="text-muted-foreground">
          Nothing has been deleted — everything already recorded can still be opened and printed.
          Choose a plan and the hospital picks up where it left off.
        </span>
      </Strip>
    );
  }

  // Administrators only, from here down. A front desk clerk cannot choose a
  // plan, and these are dense work screens -- a permanent strip nobody on
  // shift can action is the kind of thing staff learn to stop seeing, which
  // costs the warning its value on the screens where it does apply.
  if (!isAdminRole(role) || !shouldWarnAboutTrial(hospital)) return null;

  const days = trialDaysRemaining(hospital) ?? 0;

  return (
    <Strip icon={<TimerIcon className="size-4 shrink-0" />}>
      <span className="font-medium">
        {days === 1 ? 'Your trial ends tomorrow.' : `Your trial ends in ${days} days.`}
      </span>
      <span className="text-muted-foreground">
        {hospital.trial_ends_at ? `On ${formatDate(hospital.trial_ends_at)} ` : ''}
        new patients, visits and invoices stop being accepted. Everything already recorded stays
        readable.
      </span>
    </Strip>
  );
}

/**
 * One tinted strip for all three messages -- the same shape as the warning
 * badge variant, so this reads as part of the status colour family rather than
 * as a fourth design.
 */
function Strip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning dark:bg-warning/20">
      {icon}
      {children}
    </div>
  );
}

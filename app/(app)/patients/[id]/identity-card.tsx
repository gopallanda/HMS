import { CalendarDaysIcon, IdCardIcon, MapPinIcon, PhoneIcon, UserRoundIcon } from 'lucide-react';

import { GENDER_LABEL, type Gender } from '@/lib/patients';
import { formatAge } from '@/lib/utils/age-from-dob';
import { formatDate } from '@/lib/utils/dates';

export type PatientIdentity = {
  id: string;
  mrn: string;
  full_name: string;
  dob: string;
  gender: Gender;
  phone: string | null;
  address: string | null;
  created_at: string;
  deleted_at: string | null;
};

/**
 * Who this is -- the six facts every other panel on the page is about.
 *
 * The MRN is shown and never made editable: it comes from next_number, it is
 * printed on the card in the patient's hand and on every invoice they have
 * been given, and a record whose number can be retyped is a record that
 * stops matching its own paperwork (CLAUDE.md 3.2).
 *
 * Age is computed from dob here, as everywhere (CLAUDE.md 3.3); the date is
 * shown next to it, because "34 Y" and "12 Mar 1968" answer different
 * questions and the desk gets asked both.
 */
export function IdentityCard({ patient }: { patient: PatientIdentity }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-card p-4 text-sm shadow-sm sm:grid-cols-3 xl:grid-cols-5">
      <Fact icon={IdCardIcon} label="MRN">
        <span className="font-mono">{patient.mrn}</span>
      </Fact>

      <Fact icon={UserRoundIcon} label="Age / gender">
        <span className="tabular-nums">{formatAge(patient.dob)}</span>
        <span className="text-muted-foreground"> &middot; {GENDER_LABEL[patient.gender]}</span>
      </Fact>

      <Fact icon={CalendarDaysIcon} label="Date of birth">
        <span className="tabular-nums">{formatDate(patient.dob)}</span>
      </Fact>

      <Fact icon={PhoneIcon} label="Phone">
        {patient.phone ? (
          <a href={`tel:${patient.phone.replace(/\s/g, '')}`} className="font-mono hover:underline">
            {patient.phone}
          </a>
        ) : (
          // Not a blank cell: no phone means this patient cannot be found by
          // the search the desk reaches for first, which is worth asking about
          // the next time they are at the counter.
          <span className="text-muted-foreground">None on file</span>
        )}
      </Fact>

      <Fact icon={CalendarDaysIcon} label="Registered">
        <span className="tabular-nums">{formatDate(patient.created_at)}</span>
      </Fact>

      {patient.address ? (
        <Fact icon={MapPinIcon} label="Address" className="col-span-2 sm:col-span-3 xl:col-span-5">
          <span className="text-pretty">{patient.address}</span>
        </Fact>
      ) : null}
    </dl>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: typeof IdCardIcon;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5 stroke-[1.5]" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 min-w-0 break-words">{children}</dd>
    </div>
  );
}

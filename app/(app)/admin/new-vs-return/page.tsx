import { RepeatIcon, UserRoundCheckIcon } from 'lucide-react';
import Link from 'next/link';

import { AccessDenied } from '@/components/shell/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { Notice } from '@/components/shared/form-message';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import {
  groupPatientMix,
  patientMixLostPatients,
  patientMixReport,
  percent,
  type LostPatientRow,
  type MixDoctor,
  type MixWeek,
} from '@/lib/rpc/patient-mix';
import {
  DEFAULT_RANGE_DAYS,
  RETURN_WINDOWS,
  patientMixFilterSchema,
} from '@/lib/schemas/patient-mix';
import { createClient } from '@/lib/supabase/server';
import { formatDate, shiftIstDay, todayIst } from '@/lib/utils/dates';

export const metadata = { title: 'New vs Return' };

/** The presets, in days back from today. */
const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

/** How many not-returned patients one doctor's list shows. */
const LOST_LIMIT = 200;

/**
 * Less history than this before the range starts and "New" is overstated:
 * patients the clinic knew on paper count as new the first time they appear.
 */
const WARM_UP_DAYS = 180;

const PATH = '/admin/new-vs-return';

function reportHref(
  params: { from: string; to: string; window: number; doctor?: string | null },
  hash = '',
) {
  const search = new URLSearchParams({
    from: params.from,
    to: params.to,
    window: String(params.window),
  });
  if (params.doctor) search.set('doctor', params.doctor);
  return `${PATH}?${search.toString()}${hash}`;
}

/**
 * New vs Return.
 *
 * The N and R a clinic writes beside each name in its register, worked out
 * from visit history rather than written by anybody, and shown to the
 * administrator only -- nothing on the desk or the queue says N or R.
 *
 * Read-only. Its questions are: how many patients are new, how many come back,
 * which doctors' new patients return to them, and which go to somebody else.
 * The figures that matter most carry their counts beside the percentage,
 * because 100% of two patients is not a finding.
 */
export default async function NewVsReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const held = session.access.permissions;

  // The proxy guards this route too (ROUTE_PERMISSIONS). This is the layer a
  // stale bookmark hits.
  if (!held.has('reports.patients')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="The New vs Return report"
        audience="administrators"
      />
    );
  }

  const filters = patientMixFilterSchema.parse(await searchParams);
  const today = todayIst();
  const rangeTo = filters.to ?? today;
  const rangeFrom = filters.from ?? shiftIstDay(rangeTo, -(DEFAULT_RANGE_DAYS - 1));
  const [startDay, endDay] =
    rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];
  const windowDays = filters.window;
  const doctorId = filters.doctor ?? null;
  const mayListPatients = held.has('patients.read');

  const supabase = await createClient();
  const [report, earliest, lost] = await Promise.all([
    patientMixReport(supabase, session.hospitalId, startDay, endDay, windowDays),
    // When this hospital's records begin, for the warm-up notice.
    supabase
      .from('visits')
      .select('visited_at')
      .eq('hospital_id', session.hospitalId)
      .order('visited_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    doctorId && mayListPatients
      ? patientMixLostPatients(
          supabase,
          session.hospitalId,
          doctorId,
          startDay,
          endDay,
          windowDays,
          LOST_LIMIT,
        )
      : Promise.resolve(null),
  ]);

  const filterForm = (
    <form className="grid grid-cols-2 items-end gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm md:flex md:flex-wrap md:rounded-xl md:p-4">
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">From</span>
        <DatePicker name="from" defaultValue={startDay} max={today} className="md:w-44" />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">To</span>
        <DatePicker name="to" defaultValue={endDay} max={today} className="md:w-44" />
      </div>
      <div className="col-span-2 grid gap-1.5 md:col-span-1">
        <span className="text-sm font-medium">Came back within</span>
        {/* A named Radix Select posts through its hidden native select, so
            this stays a plain GET form. */}
        <Select name="window" defaultValue={String(windowDays)}>
          <SelectTrigger className="w-full md:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {RETURN_WINDOWS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {days} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {doctorId ? <input type="hidden" name="doctor" value={doctorId} /> : null}
      <Button type="submit" className="col-span-2 md:col-span-1">
        Show
      </Button>
      <div className="col-span-2 grid grid-flow-col gap-1 rounded-xl bg-muted p-1 md:ml-auto md:flex md:items-center md:gap-1.5 md:rounded-none md:bg-transparent md:p-0">
        {RANGES.map((range) => {
          const presetFrom = shiftIstDay(today, -(range.days - 1));
          const active = startDay === presetFrom && endDay === today;
          return (
            <Button
              key={range.days}
              asChild
              variant={active ? 'secondary' : 'ghost'}
              size="sm"
              className="max-md:rounded-lg max-md:data-[variant=secondary]:bg-background max-md:data-[variant=secondary]:shadow-sm"
            >
              <Link href={reportHref({ from: presetFrom, to: today, window: windowDays })}>
                {range.label}
              </Link>
            </Button>
          );
        })}
      </div>
    </form>
  );

  if (report.error) {
    return (
      <div className="grid gap-5">
        <PageHeader title="New vs Return" />
        {filterForm}
        <p className="rounded-xl bg-destructive/10 px-3.5 py-3 text-sm text-destructive md:rounded-lg md:px-3 md:py-2.5">
          The report could not be run, so nothing is shown rather than a partial answer:{' '}
          {report.error.message}
        </p>
      </div>
    );
  }

  const { summary, doctors, weeks } = groupPatientMix(report.data ?? [], startDay, endDay);
  const returning = summary.visits - summary.newToHospital;
  const firstRecordDay = earliest.data ? todayIst(new Date(earliest.data.visited_at)) : null;
  const warmingUp =
    firstRecordDay !== null && firstRecordDay > shiftIstDay(startDay, -WARM_UP_DAYS);
  const selected = doctorId ? (doctors.find((row) => row.doctorId === doctorId) ?? null) : null;
  const returnRate = percent(summary.cameBack, summary.cohortMatured);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="New vs Return"
        description={`${formatDate(startDay)} to ${formatDate(endDay)} · ${summary.visits} visit${summary.visits === 1 ? '' : 's'} · came back means within ${windowDays} days`}
      />

      {filterForm}

      {warmingUp ? (
        <Notice>
          This hospital&apos;s records start on {formatDate(firstRecordDay!)}. A patient the
          clinic saw before that, on paper, counts as New the first time they appear here, so
          New is overstated for the first few months.
        </Notice>
      ) : null}

      {summary.visits === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl">
          <EmptyState
            icon={RepeatIcon}
            title="No visits in this range"
            description="Nobody was seen between these dates, or every visit was cancelled. Widen the range to look further back."
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Tile
              label="Visits"
              value={String(summary.visits)}
              detail={`${summary.patients} different patient${summary.patients === 1 ? '' : 's'}`}
            />
            <Tile
              label="New patients"
              value={String(summary.newToHospital)}
              detail={`${percent(summary.newToHospital, summary.visits)}% of visits were somebody's first here`}
            />
            <Tile
              label="Returning visits"
              value={String(returning)}
              detail={`${percent(returning, summary.visits)}% of visits · ${summary.newToDoctor} of them saw a doctor for the first time`}
            />
            <Tile
              label={`Came back within ${windowDays} days`}
              value={returnRate === null ? '—' : `${returnRate}%`}
              detail={
                summary.cohortMatured === 0
                  ? 'No new patient in this range is old enough to tell yet'
                  : `${summary.cameBack} of ${summary.cohortMatured} new patients whose ${windowDays} days have passed`
              }
            />
          </div>

          <WeeklyChart weeks={weeks} />

          <section className="grid gap-2">
            <h2 className="px-1 text-base font-semibold md:px-0 md:text-sm">By doctor</h2>
            {doctors.length === 0 ? (
              <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground md:rounded-lg md:px-3 md:py-2">
                None of these visits has a doctor on it.
              </p>
            ) : (
              <DoctorTable
                doctors={doctors}
                windowDays={windowDays}
                selectedId={doctorId}
                hrefFor={(id) =>
                  reportHref({ from: startDay, to: endDay, window: windowDays, doctor: id }, '#lost')
                }
              />
            )}
            <p className="px-1 text-xs text-muted-foreground md:px-0">
              Grouped by department, because that is the fair comparison: a GP who cures a fever
              should not see that patient again, and a diabetologist should see theirs every
              month. A low return rate is a question to ask, not a verdict. Click a doctor to list
              the new patients who did not come back to them.
            </p>
          </section>

          {doctorId ? (
            <section id="lost" className="grid scroll-mt-4 gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="px-1 text-base font-semibold md:px-0 md:text-sm">
                  New patients of {selected?.doctorName ?? 'this doctor'} who did not come back
                  within {windowDays} days
                </h2>
                <Link
                  href={reportHref({ from: startDay, to: endDay, window: windowDays })}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Close list
                </Link>
              </div>
              {!mayListPatients ? (
                <Notice>
                  This list has patient names and mobile numbers on it, so it also needs
                  patients.read. Ask an administrator to add it to your role.
                </Notice>
              ) : lost?.error ? (
                <p className="rounded-xl bg-destructive/10 px-3.5 py-3 text-sm text-destructive md:rounded-lg md:px-3 md:py-2.5">
                  The list could not be loaded: {lost.error.message}
                </p>
              ) : (
                <LostPatients rows={lost?.data ?? []} windowDays={windowDays} />
              )}
            </section>
          ) : null}
        </>
      )}

      <p className="px-1 text-xs text-muted-foreground md:px-0">
        Worked out from visit history; nobody marks N or R. <strong>New</strong> is a
        patient&apos;s first visit to this hospital. <strong>New to doctor</strong> is somebody
        the hospital knows seeing that doctor for the first time. <strong>Repeat</strong> is a
        visit to a doctor who has seen them before. Cancelled visits are left out, and a
        transferred visit counts for the doctor it ended with. <strong>Came back</strong> means
        another visit on a later day within the window, so a patient first seen in the last{' '}
        {windowDays} days is not counted either way yet. Two records for one person make them look
        new twice. Days are IST calendar days.
      </p>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm md:rounded-xl md:p-4">
      <p className="line-clamp-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:text-xs">
        {label}
      </p>
      <p className="mt-1.5 text-2xl leading-none font-bold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground md:line-clamp-none">
        {detail}
      </p>
    </div>
  );
}

/**
 * New and returning visits, one stacked bar per week.
 *
 * Plain HTML rather than a chart library: two series and one axis. New sits
 * on the baseline because it is the figure people compare week to week. Each
 * column's native tooltip carries both numbers, and the same figures are one
 * click away as a table.
 */
function WeeklyChart({ weeks }: { weeks: MixWeek[] }) {
  // Headroom above the tallest bar, so the 2px gap between segments cannot
  // push its top past the plot.
  const peak = Math.max(1, ...weeks.map((week) => week.visits)) * 1.05;
  const totalNew = weeks.reduce((sum, week) => sum + week.newToHospital, 0);
  const totalReturning = weeks.reduce((sum, week) => sum + week.visits - week.newToHospital, 0);
  const middle = weeks[Math.floor((weeks.length - 1) / 2)];

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 md:px-0">
        <h2 className="text-base font-semibold md:text-sm">Week by week</h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <LegendKey className="bg-chart-1" label="New" value={totalNew} />
          <LegendKey className="bg-chart-3" label="Returning" value={totalReturning} />
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm md:rounded-xl">
        <div
          role="img"
          aria-label={`Weekly visits: ${totalNew} new and ${totalReturning} returning in total. The same figures are in the table below.`}
          className="flex h-44 items-end gap-[2px] border-b border-border"
        >
          {weeks.map((week) => {
            const returningCount = week.visits - week.newToHospital;
            return (
              <div
                key={week.weekStart}
                title={`Week of ${formatDate(week.weekStart)}: ${week.newToHospital} new, ${returningCount} returning`}
                className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px] rounded-t-[4px] hover:bg-muted/60"
              >
                {returningCount > 0 ? (
                  <div
                    className="w-full rounded-t-[4px] bg-chart-3"
                    style={{ height: `${(returningCount / peak) * 100}%` }}
                  />
                ) : null}
                {week.newToHospital > 0 ? (
                  <div
                    className={cn('w-full bg-chart-1', returningCount === 0 && 'rounded-t-[4px]')}
                    style={{ height: `${(week.newToHospital / peak) * 100}%` }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{weeks[0] ? formatDate(weeks[0].weekStart) : ''}</span>
          {weeks.length > 2 && middle ? <span>{formatDate(middle.weekStart)}</span> : null}
          <span>{weeks.length > 1 ? formatDate(weeks[weeks.length - 1].weekStart) : ''}</span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            Show the weeks as a table
          </summary>
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week of</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="text-right">Returning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((week) => (
                  <TableRow key={week.weekStart} className="even:bg-muted/25">
                    <TableCell>{formatDate(week.weekStart)}</TableCell>
                    <TableCell className="text-right tabular-nums">{week.visits}</TableCell>
                    <TableCell className="text-right tabular-nums">{week.newToHospital}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {week.visits - week.newToHospital}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      </div>
    </section>
  );
}

function LegendKey({
  className,
  label,
  value,
}: {
  className: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-[2px]', className)} aria-hidden />
      <span>
        {label} <span className="font-medium text-foreground tabular-nums">{value}</span>
      </span>
    </span>
  );
}

function DoctorTable({
  doctors,
  windowDays,
  selectedId,
  hrefFor,
}: {
  doctors: MixDoctor[];
  windowDays: number;
  selectedId: string | null;
  hrefFor: (doctorId: string) => string;
}) {
  return (
    <>
      {/* Phone: the four figures that matter per doctor; the full ten columns
          are on the desk. Tapping a card opens the lost-patient list. */}
      <div className="grid gap-2.5 md:hidden">
        {doctors.map((doctor) => {
          const rate = doctor.cohortMatured === 0 ? null : percent(doctor.cameBack, doctor.cohortMatured);
          return (
            <Link
              key={doctor.doctorId}
              href={hrefFor(doctor.doctorId)}
              className={cn(
                'rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm transition active:scale-[0.99]',
                doctor.doctorId === selectedId && 'border-primary/50 bg-primary/5 ring-1 ring-primary/30',
              )}
            >
              <p className="truncate text-[15px] font-semibold">{doctor.doctorName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {doctor.departmentName ?? 'No department'}
              </p>
              <dl className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-center">
                {[
                  ['Visits', String(doctor.visits)],
                  ['New', String(doctor.newToHospital)],
                  ['Repeat', String(doctor.repeatVisits)],
                  [`≤ ${windowDays}d`, rate === null ? '—' : `${rate}%`],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="truncate text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-bold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </Link>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-sm md:block md:rounded-xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-44">Doctor</TableHead>
              <TableHead className="text-right">Visits</TableHead>
              <TableHead className="text-right">Patients</TableHead>
              <TableHead className="text-right">New to hospital</TableHead>
              <TableHead className="text-right">New to doctor</TableHead>
              <TableHead className="text-right">Repeat</TableHead>
              <TableHead className="text-right">Came back ≤ {windowDays}d</TableHead>
              <TableHead className="text-right">Went to another doctor</TableHead>
              <TableHead className="text-right">Visits per patient</TableHead>
              <TableHead className="text-right">Median days between</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {doctors.map((doctor) => (
              <TableRow
                key={doctor.doctorId}
                className={cn(
                  'even:bg-muted/25',
                  doctor.doctorId === selectedId && 'border-l-4 border-l-primary bg-primary/5',
                )}
              >
                <TableCell>
                  <Link
                    href={hrefFor(doctor.doctorId)}
                    className="font-medium text-primary hover:underline"
                  >
                    {doctor.doctorName}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {doctor.departmentName ?? 'No department'}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{doctor.visits}</TableCell>
                <TableCell className="text-right tabular-nums">{doctor.patients}</TableCell>
                <TableCell className="text-right tabular-nums">{doctor.newToHospital}</TableCell>
                <TableCell className="text-right tabular-nums">{doctor.newToDoctor}</TableCell>
                <TableCell className="text-right tabular-nums">{doctor.repeatVisits}</TableCell>
                <RateCell part={doctor.cameBack} whole={doctor.cohortMatured} cohort={doctor.cohort} />
                <RateCell
                  part={doctor.wentElsewhere}
                  whole={doctor.cohortMatured}
                  cohort={doctor.cohort}
                />
                <TableCell className="text-right tabular-nums">
                  {(doctor.visits / Math.max(1, doctor.patients)).toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {doctor.medianGapDays === null ? (
                    <span className="text-muted-foreground/40">&mdash;</span>
                  ) : (
                    doctor.medianGapDays
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** A percentage with the count it came from underneath it. */
function RateCell({ part, whole, cohort }: { part: number; whole: number; cohort: number }) {
  if (cohort === 0) {
    return (
      <TableCell className="text-right">
        <span className="text-muted-foreground/40">&mdash;</span>
      </TableCell>
    );
  }
  if (whole === 0) {
    return (
      <TableCell className="text-right">
        <span className="text-xs text-muted-foreground">too recent</span>
      </TableCell>
    );
  }
  return (
    <TableCell className="text-right">
      <span className="block font-medium tabular-nums">{percent(part, whole)}%</span>
      <span className="block text-xs text-muted-foreground tabular-nums">
        {part} of {whole}
      </span>
    </TableCell>
  );
}

function LostPatients({ rows, windowDays }: { rows: LostPatientRow[]; windowDays: number }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm md:rounded-xl">
        <EmptyState
          icon={UserRoundCheckIcon}
          title="Nobody to list"
          description={`Every new patient of this doctor whose ${windowDays} days have passed came back to them, or none is old enough to tell yet.`}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-2.5 md:hidden">
        {rows.map((row) => (
          <div key={row.patient_id} className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/patients/${row.patient_id}`}
                  className="block truncate text-[15px] font-semibold text-primary"
                >
                  {row.full_name}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.mrn} &middot; first seen {formatDate(row.first_visit_at)}
                </p>
              </div>
              {row.phone ? (
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <a href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}>Call</a>
                </Button>
              ) : null}
            </div>
            <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-md bg-muted/70 px-1.5 py-0.5">
                {row.new_to_hospital ? 'New patient' : 'Seen before'}
              </span>
              {row.seen_other_doctor ? (
                <span className="rounded-md bg-warning/10 px-1.5 py-0.5 font-medium text-warning">
                  Saw another doctor within {windowDays} days
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-sm md:block md:rounded-xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>MRN</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>First seen by this doctor</TableHead>
              <TableHead>Known to hospital</TableHead>
              <TableHead>Saw another doctor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.patient_id} className="even:bg-muted/25">
                <TableCell>
                  <Link
                    href={`/patients/${row.patient_id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.full_name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.mrn}</TableCell>
                <TableCell className="font-mono text-xs">{row.phone ?? 'No mobile'}</TableCell>
                <TableCell className="tabular-nums">{formatDate(row.first_visit_at)}</TableCell>
                <TableCell>{row.new_to_hospital ? 'New patient' : 'Seen before'}</TableCell>
                <TableCell>
                  {row.seen_other_doctor ? (
                    <span className="font-medium">Yes, within {windowDays} days</span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length >= LOST_LIMIT ? (
        <Notice>Showing the {LOST_LIMIT} most recent. Narrow the range to see the rest.</Notice>
      ) : null}
    </div>
  );
}

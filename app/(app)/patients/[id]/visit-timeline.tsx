import { CalendarClockIcon } from 'lucide-react';
import Link from 'next/link';

import { SectionCard, SectionError } from './section';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatTime } from '@/lib/utils/dates';
import { formatAmount } from '@/lib/utils/money';
import {
  VISIT_STATUS_LABEL,
  VISIT_STATUS_VARIANT,
  VISIT_TYPE_LABEL,
  type VisitStatus,
  type VisitType,
} from '@/lib/visits';

export type PatientVisit = {
  id: string;
  visit_no: string;
  token_no: number;
  visit_type: VisitType;
  status: VisitStatus;
  visited_at: string;
  doctor_name: string | null;
  department_name: string | null;
  charge_total: number;
};

/**
 * Every visit this patient has made, newest first.
 *
 * This is the shared spine of the record: the cashier, the doctor and the lab
 * all get it, because "when were they last here and who saw them" is not
 * privileged information in a hospital that is treating them.
 *
 * The doctor's consultation screen carries the same list capped at ten, with a
 * comment saying a full history belongs on the patient rather than on one
 * visit. This is that list, and that panel links here.
 */
export function VisitTimeline({
  visits,
  error,
  shown,
  clinical,
}: {
  /** null when the read failed -- which is not the same as "no visits". */
  visits: PatientVisit[] | null;
  error?: string;
  /** How many rows to render before offering ?visits=all. */
  shown: number;
  /** Whether a row should open the consultation. Non-clinical roles cannot read it. */
  clinical: boolean;
}) {
  if (visits === null) {
    return (
      <SectionCard id="visits" title="Visits">
        <SectionError>
          The visit history could not be read, so this is not an empty history — it is an unknown
          one. {error}
        </SectionError>
      </SectionCard>
    );
  }

  const rows = visits.slice(0, shown);
  const hidden = visits.length - rows.length;

  return (
    <SectionCard
      id="visits"
      title="Visits"
      count={visits.length}
      action={
        hidden > 0 ? (
          <Link
            href="?visits=all#visits"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Show all {visits.length}
          </Link>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={CalendarClockIcon}
          title="No visits yet"
          description="This patient is registered but has never been seen. A visit is started at the front desk."
        />
      ) : (
        <>
          {/* Below `md` the seven columns become one card per visit. A phone has
              room for what happened and when, not for a table (CLAUDE.md 7). */}
          <div className="grid gap-2 md:hidden">
            {rows.map((visit) => (
              <div key={visit.id} className="rounded-lg border border-border/60 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">
                      {formatDate(visit.visited_at)}{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        {formatTime(visit.visited_at)}
                      </span>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {visit.visit_no} &middot; token {visit.token_no}
                    </p>
                  </div>
                  <Badge variant={VISIT_STATUS_VARIANT[visit.status]} className="shrink-0">
                    {VISIT_STATUS_LABEL[visit.status]}
                  </Badge>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-border/60 pt-2 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {visit.doctor_name ?? 'No doctor'}
                    {visit.department_name ? ` · ${visit.department_name}` : ''}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    &#8377;{formatAmount(visit.charge_total)}
                  </span>
                </div>
                {clinical ? (
                  <Link
                    href={`/doctor/visit/${visit.id}`}
                    className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open consultation
                  </Link>
                ) : null}
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Date</TableHead>
                  <TableHead className="w-44">Visit</TableHead>
                  <TableHead className="w-16 text-right">Token</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead className="hidden lg:table-cell">Department</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-28 text-right">Charges &#8377;</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((visit) => (
                  <TableRow key={visit.id}>
                    <TableCell className="tabular-nums">
                      {formatDate(visit.visited_at)}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {formatTime(visit.visited_at)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {/* Only clinical roles may read a consultation
                          (consultations_select_clinical), so only they are
                          offered the door to one. */}
                      {clinical ? (
                        <Link
                          href={`/doctor/visit/${visit.id}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {visit.visit_no}
                        </Link>
                      ) : (
                        visit.visit_no
                      )}
                      <span className="ml-1.5 text-muted-foreground">
                        {VISIT_TYPE_LABEL[visit.visit_type]}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{visit.token_no}</TableCell>
                    <TableCell className="truncate">
                      {visit.doctor_name ?? <span className="text-muted-foreground">No doctor</span>}
                    </TableCell>
                    <TableCell className="hidden truncate text-muted-foreground lg:table-cell">
                      {visit.department_name ?? '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={VISIT_STATUS_VARIANT[visit.status]}>
                        {VISIT_STATUS_LABEL[visit.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(visit.charge_total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

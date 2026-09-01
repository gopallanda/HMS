import Link from 'next/link';

import { CancelVisitDialog } from '../cancel-visit-dialog';
import { TransferDialog, type TransferDoctor } from './transfer-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { AccessDenied } from '@/components/shell/access-denied';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CircleCheckIcon } from 'lucide-react';
import { requireSession, roleDisplayName } from '@/lib/auth/session';
import { ageGender } from '@/lib/patients';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/utils/dates';

export const metadata = { title: 'Visits needing a doctor' };

/**
 * The repair list (block 7.2).
 *
 * Registration cannot produce a visit with no doctor any anymore -- the RPC
 * refuses one. So every row here is either historical data from before this
 * phase, or an emergency registered before anybody knew who would see the
 * patient.
 *
 * They are SURFACED rather than migrated, deliberately. A backfill would have
 * to guess a doctor, and guessing writes a clinical record that is not true:
 * whoever is named on that visit is the person the notes and the consultation
 * fee will be attributed to. The hospital's own staff know who actually saw
 * these patients; this screen is where they say so.
 *
 * It is expected to be empty, and when it is it says so rather than showing an
 * empty table -- an empty table reads as broken.
 */
export default async function IncompleteVisitsPage() {
  const session = await requireSession();

  if (!session.access.permissions.has('queue.read')) {
    return (
      <AccessDenied
        roleName={roleDisplayName(session)}
        area="The repair list"
        audience="reception staff"
      />
    );
  }

  const supabase = await createClient();

  const [visitResult, doctorResult] = await Promise.all([
    supabase
      .from('incomplete_visits')
      .select(
        'id, visit_no, token_no, status, visited_at, patient_id, patient_mrn, patient_name, patient_dob, patient_gender, patient_phone, department_name, payment_due',
      )
      .eq('hospital_id', session.hospitalId)
      .order('visited_at', { ascending: false })
      .limit(200),
    supabase
      .from('staff')
      .select('id, full_name, department_id')
      .eq('hospital_id', session.hospitalId)
      .eq('role', 'doctor')
      .eq('is_active', true)
      .order('full_name'),
  ]);

  if (visitResult.error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Visits needing a doctor" />
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          The list could not be loaded: {visitResult.error.message}
        </p>
      </div>
    );
  }

  const visits = visitResult.data ?? [];
  const doctors: TransferDoctor[] = doctorResult.data ?? [];
  const canManage = session.access.permissions.has('queue.manage');
  const canCancel = session.access.permissions.has('queue.cancel');

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Visits needing a doctor"
        description="Open visits with nobody assigned. Registration can no longer create one; these are older records to repair."
        actions={
          <Button asChild variant="outline">
            <Link href="/front-desk/queue">Today&apos;s queue</Link>
          </Button>
        }
      />

      {visits.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <EmptyState
            icon={CircleCheckIcon}
            title="Nothing to repair"
            description="Every open visit has a doctor. This list fills only with records that predate one-transaction registration."
          />
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Registered</TableHead>
                <TableHead className="w-24">Visit</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead className="w-24">Age / sex</TableHead>
                <TableHead className="w-36">Department</TableHead>
                <TableHead className="w-28">Payment</TableHead>
                <TableHead className="w-32 text-right">Repair</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.map((visit) => (
                <TableRow key={visit.id}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(visit.visited_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{visit.visit_no}</TableCell>
                  <TableCell>
                    <Link
                      href={`/patients/${visit.patient_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {visit.patient_name}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {visit.patient_mrn}
                      {visit.patient_phone ? ` - ${visit.patient_phone}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {ageGender(visit.patient_dob, visit.patient_gender)}
                  </TableCell>
                  <TableCell className="truncate text-xs">
                    {visit.department_name ?? '-'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {visit.payment_due ? (
                      <span className="font-bold tracking-wide text-warning uppercase">Due</span>
                    ) : (
                      <span className="text-muted-foreground">Settled</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canManage ? (
                        <TransferDialog
                          visitId={visit.id}
                          patientName={visit.patient_name}
                          currentDoctor={null}
                          doctors={doctors}
                          trigger="Assign a doctor"
                        />
                      ) : null}
                      {/* The other honest answer to a visit nobody can place:
                          it should never have been open. Cancelling says so,
                          with a reason, instead of leaving the row here for
                          somebody to guess a doctor for later. */}
                      {canCancel ? (
                        <CancelVisitDialog
                          visitId={visit.id}
                          visitNo={visit.visit_no}
                          patientName={visit.patient_name}
                          tokenNo={visit.token_no}
                        />
                      ) : null}
                      {!canManage && !canCancel ? (
                        <span className="text-xs text-muted-foreground">Ask the front desk</span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

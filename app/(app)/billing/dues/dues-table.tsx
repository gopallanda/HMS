'use client';

import { IndianRupeeIcon, PrinterIcon, WalletCardsIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  CollectBalanceDialog,
  type CollectBalanceTarget,
} from '@/components/shared/collect-balance-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  bucketFor,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  type AgeBucket,
  type InvoiceStatus,
} from '@/lib/billing';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/utils/dates';
import { formatAmount } from '@/lib/utils/money';

export type DueRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  status: InvoiceStatus;
  grand_total: number;
  paid_total: number;
  balance: number;
  patient_id: string;
  patient_name_snapshot: string;
  patient_mrn: string;
  patient_phone: string | null;
  /** Whole days between the invoice date and today, in IST. */
  age_days: number;
};

const BUCKET_TONE: Record<AgeBucket, string> = {
  fresh: 'text-muted-foreground',
  chasing: 'text-warning',
  old: 'text-destructive',
};

export function DuesTable({
  rows,
  canCollect,
}: {
  rows: DueRow[];
  /** billing.collect. Without it this is a list to read, not a list to work. */
  canCollect: boolean;
}) {
  const [collecting, setCollecting] = useState<DueRow | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <EmptyState
          icon={WalletCardsIcon}
          title="Nothing outstanding"
          description="Every invoice that is not void has been paid in full."
        />
      </div>
    );
  }

  function target(row: DueRow): CollectBalanceTarget {
    return {
      invoiceId: row.id,
      invoiceNo: row.invoice_no,
      patientName: row.patient_name_snapshot,
      balance: row.balance,
    };
  }

  return (
    <>
      {/* Cards below `lg`. The phone number is the point of this screen on a
          phone: somebody is standing up from the desk to make the call. */}
      <div className="grid gap-2 lg:hidden">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-xl border border-border/60 bg-card p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/patients/${row.patient_id}`}
                  className="block truncate font-medium underline-offset-4 hover:underline"
                >
                  {row.patient_name_snapshot}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.patient_mrn}
                  {row.patient_phone ? ` · ${row.patient_phone}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block font-bold text-destructive tabular-nums">
                  &#8377;{formatAmount(row.balance)}
                </span>
                <span className={cn('block text-xs', BUCKET_TONE[bucketFor(row.age_days)])}>
                  {row.age_days} day{row.age_days === 1 ? '' : 's'}
                </span>
              </span>
            </div>

            <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2.5">
              <span className="truncate font-mono text-xs text-muted-foreground">
                {row.invoice_no} &middot; {formatDate(row.invoice_date)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {canCollect ? (
                  <Button variant="outline" size="sm" onClick={() => setCollecting(row)}>
                    <IndianRupeeIcon data-icon="inline-start" />
                    Collect
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="icon-sm" title="Print">
                  <Link href={`/print/receipt/${row.id}?autoprint=0`}>
                    <PrinterIcon />
                    <span className="sr-only">Print {row.invoice_no}</span>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Invoice</TableHead>
              <TableHead className="w-28">Raised</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="w-36">Phone</TableHead>
              <TableHead className="w-24 text-right">Total &#8377;</TableHead>
              <TableHead className="w-24 text-right">Paid &#8377;</TableHead>
              <TableHead className="w-28 text-right">Owing &#8377;</TableHead>
              <TableHead className="w-24">Age</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="even:bg-muted/25">
                <TableCell className="font-mono text-xs">{row.invoice_no}</TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(row.invoice_date)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/patients/${row.patient_id}`}
                    className="truncate font-medium underline-offset-4 hover:underline"
                  >
                    {row.patient_name_snapshot}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {row.patient_mrn}
                  </span>
                </TableCell>
                {/* The number somebody rings. It is on this screen and not on
                    the invoice list for that reason alone. */}
                <TableCell className="font-mono text-xs">{row.patient_phone ?? '-'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(row.grand_total)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatAmount(row.paid_total)}
                </TableCell>
                <TableCell className="text-right font-medium text-destructive tabular-nums">
                  {formatAmount(row.balance)}
                </TableCell>
                <TableCell
                  className={cn('text-xs tabular-nums', BUCKET_TONE[bucketFor(row.age_days)])}
                >
                  {row.age_days} day{row.age_days === 1 ? '' : 's'}
                </TableCell>
                <TableCell>
                  <Badge variant={INVOICE_STATUS_VARIANT[row.status]}>
                    {INVOICE_STATUS_LABEL[row.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {canCollect ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={`Collect the ${formatAmount(row.balance)} still owing`}
                        onClick={() => setCollecting(row)}
                      >
                        <IndianRupeeIcon className="text-success" />
                        <span className="sr-only">Collect balance on {row.invoice_no}</span>
                      </Button>
                    ) : null}
                    <Button asChild variant="ghost" size="icon-sm" title="Print">
                      <Link href={`/print/receipt/${row.id}?autoprint=0`}>
                        <PrinterIcon />
                        <span className="sr-only">Print {row.invoice_no}</span>
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {collecting ? (
        <CollectBalanceDialog
          target={target(collecting)}
          onClose={() => setCollecting(null)}
        />
      ) : null}
    </>
  );
}

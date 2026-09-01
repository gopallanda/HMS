'use client';

import { BanIcon, IndianRupeeIcon, PrinterIcon, ReceiptIcon } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { voidInvoiceAction } from './actions';
import {
  CollectBalanceDialog,
  type CollectBalanceTarget,
} from '@/components/shared/collect-balance-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldError, IDLE, type ActionState } from '@/lib/action-state';
import { cn } from '@/lib/cn';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  PAYMENT_MODE_LABEL,
  type InvoiceStatus,
  type PaymentMode,
} from '@/lib/billing';
import { formatDateTime } from '@/lib/utils/dates';
import { formatAmount, formatMoney } from '@/lib/utils/money';

export type InvoiceRowData = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  status: InvoiceStatus;
  void_reason: string | null;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  paid_total: number;
  balance: number;
  patient_id: string;
  patient_name_snapshot: string;
  patient_mrn: string;
  visit_no: string;
  token_no: number;
  doctor_name: string | null;
  department_name: string | null;
  payment_modes: PaymentMode[] | null;
  created_by_name: string | null;
};

/** An invoice still owing money is one somebody can pay. */
function isCollectable(invoice: InvoiceRowData): boolean {
  return invoice.status !== 'void' && invoice.balance > 0;
}

function targetFor(invoice: InvoiceRowData): CollectBalanceTarget {
  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoice_no,
    patientName: invoice.patient_name_snapshot,
    balance: invoice.balance,
  };
}

export function InvoiceTable({
  invoices,
  canCollect,
}: {
  invoices: InvoiceRowData[];
  /**
   * billing.collect. Without it the row offers Print and Void only -- an
   * accountant reconciles and voids, and does not stand at the counter.
   * The action re-checks: this only decides whether a button is drawn.
   */
  canCollect: boolean;
}) {
  const [voiding, setVoiding] = useState<InvoiceRowData | null>(null);
  const [collecting, setCollecting] = useState<InvoiceRowData | null>(null);

  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <EmptyState
          icon={ReceiptIcon}
          title="No invoices here"
          description="Change the day, or search across every date."
        />
      </div>
    );
  }

  return (
    <>
      {/* Below `lg` the nine columns become one card per invoice. The numbers
          stay right-aligned and tabular inside the card, so a column of totals
          is still a column of totals on a phone (CLAUDE.md 7). */}
      <div className="grid gap-2 lg:hidden">
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            className={cn(
              'rounded-xl border border-border/60 bg-card p-3 shadow-sm',
              invoice.status === 'void' && 'opacity-60',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className={cn(
                    'truncate font-mono text-xs',
                    invoice.status === 'void' && 'line-through',
                  )}
                >
                  {invoice.invoice_no}
                </p>
                <Link
                  href={`/patients/${invoice.patient_id}`}
                  className="mt-0.5 block truncate font-medium underline-offset-4 hover:underline"
                >
                  {invoice.patient_name_snapshot}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {invoice.patient_mrn} &middot; token {invoice.token_no}
                </p>
              </div>
              <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]} className="shrink-0">
                {INVOICE_STATUS_LABEL[invoice.status]}
              </Badge>
            </div>

            <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5 text-xs">
              <div>
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-medium tabular-nums">{formatAmount(invoice.grand_total)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="tabular-nums">{formatAmount(invoice.paid_total)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Balance</dt>
                <dd
                  className={cn(
                    'tabular-nums',
                    invoice.balance > 0 ? 'font-medium text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {invoice.balance > 0 ? formatAmount(invoice.balance) : '-'}
                </dd>
              </div>
            </dl>

            {invoice.void_reason ? (
              <p className="mt-2 text-xs text-muted-foreground">{invoice.void_reason}</p>
            ) : null}

            <div className="mt-2.5 flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(invoice.invoice_date)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {canCollect && isCollectable(invoice) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCollecting(invoice)}
                  >
                    <IndianRupeeIcon data-icon="inline-start" />
                    Collect
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="icon-sm" title="Print">
                  <Link href={`/print/receipt/${invoice.id}?autoprint=0`}>
                    <PrinterIcon />
                    <span className="sr-only">Print {invoice.invoice_no}</span>
                  </Link>
                </Button>
                {invoice.status === 'void' ? null : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Void"
                    onClick={() => setVoiding(invoice)}
                  >
                    <BanIcon className="text-destructive" />
                    <span className="sr-only">Void {invoice.invoice_no}</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Invoice</TableHead>
              <TableHead className="w-36">Raised</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="w-40">Doctor</TableHead>
              <TableHead className="w-28 text-right">Total &#8377;</TableHead>
              <TableHead className="w-28 text-right">Paid &#8377;</TableHead>
              <TableHead className="w-28 text-right">Balance &#8377;</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow
                key={invoice.id}
                className={cn(
                  'even:bg-muted/25',
                  invoice.status === 'void' && 'opacity-60',
                )}
              >
                <TableCell
                  className={cn(
                    'font-mono text-xs',
                    invoice.status === 'void' && 'line-through',
                  )}
                >
                  {invoice.invoice_no}
                  {invoice.void_reason ? (
                    <span
                      className="block truncate font-sans text-xs text-muted-foreground"
                      title={invoice.void_reason}
                    >
                      {invoice.void_reason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(invoice.invoice_date)}
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    {/* The snapshot is what was printed on this bill; the
                        link goes to the record as it stands today, which is
                        exactly the pair somebody chasing a balance needs
                        (CLAUDE.md 4). */}
                    <Link
                      href={`/patients/${invoice.patient_id}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {invoice.patient_name_snapshot}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {invoice.patient_mrn} &middot; {invoice.visit_no} &middot; token{' '}
                      {invoice.token_no}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="truncate text-xs">
                  {invoice.doctor_name ?? '-'}
                  {invoice.department_name ? (
                    <span className="block text-xs text-muted-foreground">
                      {invoice.department_name}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(invoice.grand_total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(invoice.paid_total)}
                  {invoice.payment_modes && invoice.payment_modes.length > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      {invoice.payment_modes
                        .map((mode) => PAYMENT_MODE_LABEL[mode])
                        .join(', ')}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {invoice.balance > 0 ? (
                    <span className="font-medium text-destructive">
                      {formatAmount(invoice.balance)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
                    {INVOICE_STATUS_LABEL[invoice.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {canCollect && isCollectable(invoice) ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={`Collect the ${formatAmount(invoice.balance)} still owing`}
                        onClick={() => setCollecting(invoice)}
                      >
                        <IndianRupeeIcon className="text-success" />
                        <span className="sr-only">
                          Collect balance on {invoice.invoice_no}
                        </span>
                      </Button>
                    ) : null}
                    <Button asChild variant="ghost" size="icon-sm" title="Print">
                      <Link href={`/print/receipt/${invoice.id}?autoprint=0`}>
                        <PrinterIcon />
                        <span className="sr-only">Print {invoice.invoice_no}</span>
                      </Link>
                    </Button>
                    {invoice.status === 'void' ? null : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Void"
                        onClick={() => setVoiding(invoice)}
                      >
                        <BanIcon className="text-destructive" />
                        <span className="sr-only">Void {invoice.invoice_no}</span>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Invoices are never deleted. Voiding keeps the number, records the reason, returns the
        charges to the visit so it can be billed again, and reverses any payment against it.
        Collecting adds a payment to a bill that already exists; it never raises a second one.
      </p>

      {voiding ? (
        <VoidDialog invoice={voiding} onClose={() => setVoiding(null)} />
      ) : null}

      {collecting ? (
        <CollectBalanceDialog
          target={targetFor(collecting)}
          onClose={() => setCollecting(null)}
        />
      ) : null}
    </>
  );
}

/**
 * A typed reason, not a confirm dialog (CLAUDE.md 7).
 *
 * "Are you sure?" is answered yes by reflex. Making somebody write down why
 * they are cancelling a bill is both a speed bump and the only thing that will
 * explain the gap to whoever reads the audit log next year.
 */
function VoidDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceRowData;
  onClose: () => void;
}) {
  const initial: ActionState = IDLE;
  const [state, action] = useActionState(voidInvoiceAction, initial);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Void {invoice.invoice_no}?</DialogTitle>
          <DialogDescription asChild>
            <div className="grid gap-1 text-sm">
              <span>
                {invoice.patient_name_snapshot} &middot; {formatMoney(invoice.grand_total)}
                {invoice.paid_total > 0
                  ? ` · ${formatMoney(invoice.paid_total)} already collected`
                  : ''}
              </span>
              {invoice.paid_total > 0 ? (
                <span className="text-destructive">
                  The payment will be marked reversed. Refund the money at the counter -- this
                  only records that you did.
                </span>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="invoice_id" value={invoice.id} />

          <FormMessage state={state} />

          <Field
            label="Why is this invoice being voided?"
            htmlFor="void-reason"
            error={fieldError(state, 'reason')}
            hint="Kept forever, and shown on the reprint. Be specific: a name or a wrong amount, not 'mistake'."
            required
          >
            <Textarea
              id="void-reason"
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={200}
              autoFocus
              placeholder="Billed to the wrong patient - charges belong to token 14"
              aria-invalid={fieldError(state, 'reason') !== undefined}
            />
          </Field>

          <DialogFooter className="items-center">
            <span className="mr-auto hidden text-xs text-muted-foreground sm:block">
              The number {invoice.invoice_no} stays used. Nothing is deleted.
            </span>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton
              variant="destructive"
              pendingLabel="Voiding..."
              disabled={reason.trim().length < 4}
            >
              Void invoice
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

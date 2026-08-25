'use client';

import { BanIcon, PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { voidInvoiceAction } from './actions';
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
  patient_name_snapshot: string;
  patient_mrn: string;
  visit_no: string;
  token_no: number;
  doctor_name: string | null;
  department_name: string | null;
  payment_modes: PaymentMode[] | null;
  created_by_name: string | null;
};

export function InvoiceTable({ invoices }: { invoices: InvoiceRowData[] }) {
  const [voiding, setVoiding] = useState<InvoiceRowData | null>(null);

  return (
    <>
      <div className="rounded-lg border">
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
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-xs text-muted-foreground">
                  No invoices here. Change the day, or search across every date.
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className={invoice.status === 'void' ? 'opacity-60' : undefined}
                >
                  <TableCell className="font-mono text-xs">
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
                      <span className="truncate font-medium">
                        {invoice.patient_name_snapshot}
                      </span>
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
                      <Button asChild variant="ghost" size="sm" title="Print">
                        <Link href={`/print/invoice/${invoice.id}`}>
                          <PrinterIcon />
                          <span className="sr-only">Print {invoice.invoice_no}</span>
                        </Link>
                      </Button>
                      {invoice.status === 'void' ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Invoices are never deleted. Voiding keeps the number, records the reason, returns the
        charges to the visit so it can be billed again, and reverses any payment against it.
      </p>

      {voiding ? (
        <VoidDialog invoice={voiding} onClose={() => setVoiding(null)} />
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

        <form action={action} className="grid gap-3">
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
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton
              size="sm"
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

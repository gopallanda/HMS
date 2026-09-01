'use client';

import { Undo2Icon } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { reversePaymentAction } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage, Notice } from '@/components/shared/form-message';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE } from '@/lib/action-state';
import { PAYMENT_MODE_LABEL, type PaymentMode } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/utils/dates';
import { formatAmount, formatMoney } from '@/lib/utils/money';

export type InvoicePayment = {
  id: string;
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  paid_at: string;
  is_reversed: boolean;
  reversal_reason: string | null;
  collected_by_name: string | null;
};

/**
 * What was actually collected against one bill, and the way to correct it.
 *
 * Before reverse_payment there was no screen in the product that listed the
 * payments on an invoice at all -- the list showed a `paid_total` and the
 * modes, and a cash collection keyed as UPI could only be fixed by voiding an
 * otherwise correct bill. This is the row-level view that makes a row-level
 * correction possible.
 */
export function PaymentsDialog({
  invoiceNo,
  grandTotal,
  payments,
  canReverse,
  onClose,
}: {
  invoiceNo: string;
  grandTotal: number;
  payments: InvoicePayment[];
  /** billing.void. Reversing is the same class of act as voiding. */
  canReverse: boolean;
  onClose: () => void;
}) {
  const [reversing, setReversing] = useState<InvoicePayment | null>(null);

  const live = payments.filter((payment) => !payment.is_reversed);
  const collected = live.reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payments on {invoiceNo}</DialogTitle>
          <DialogDescription>
            {formatMoney(collected)} of {formatMoney(grandTotal)} collected across{' '}
            {live.length} payment{live.length === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>

        {reversing ? (
          <ReverseForm payment={reversing} onDone={() => setReversing(null)} />
        ) : (
          <div className="grid gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Taken</TableHead>
                  <TableHead className="w-24">Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="w-32">By</TableHead>
                  <TableHead className="w-28 text-right">Amount &#8377;</TableHead>
                  <TableHead className="w-28 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow
                    key={payment.id}
                    className={cn(payment.is_reversed && 'opacity-60')}
                  >
                    <TableCell className="text-xs tabular-nums">
                      {formatDateTime(payment.paid_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {PAYMENT_MODE_LABEL[payment.mode]}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {payment.reference ?? '-'}
                      {payment.reversal_reason ? (
                        <span className="block font-sans" title={payment.reversal_reason}>
                          {payment.reversal_reason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="truncate text-xs">
                      {payment.collected_by_name ?? 'Login with no staff record'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        payment.is_reversed && 'line-through',
                      )}
                    >
                      {formatAmount(payment.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {payment.is_reversed ? (
                        <Badge variant="outline">Reversed</Badge>
                      ) : canReverse ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setReversing(payment)}
                        >
                          <Undo2Icon data-icon="inline-start" />
                          Reverse
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Said plainly, on the screen that offers the button, because the
                alternative is a cashier who believes the software refunded
                somebody. It did not. It wrote down that they did. */}
            <Notice>
              Reversing records a correction. It does not move any money &mdash; hand the cash
              back, or re-collect in the right mode, at the counter. Reversed payments stop
              counting towards the day close.
            </Notice>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A typed reason, not a confirm dialog (CLAUDE.md 7). Shown in place of the
 * list rather than stacked over it: two dialogs deep is where somebody loses
 * track of which payment they are about to undo.
 */
function ReverseForm({
  payment,
  onDone,
}: {
  payment: InvoicePayment;
  onDone: () => void;
}) {
  const [state, action] = useActionState(reversePaymentAction, IDLE);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="payment_id" value={payment.id} />

      <FormMessage state={state} />

      <p className="rounded-lg border border-border/60 px-3 py-2 text-sm">
        {formatMoney(payment.amount)} by {PAYMENT_MODE_LABEL[payment.mode]} on{' '}
        {formatDateTime(payment.paid_at)}
        {payment.reference ? `, ref ${payment.reference}` : ''}.
      </p>

      <Field
        label="Why is this payment being reversed?"
        htmlFor="reverse-reason"
        error={fieldError(state, 'reason')}
        hint="Kept forever, next to the void reasons. 'Taken in cash, keyed as UPI', not 'wrong'."
        required
      >
        <Textarea
          id="reverse-reason"
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={200}
          autoFocus
          placeholder="Taken in cash, recorded as UPI by mistake"
          aria-invalid={fieldError(state, 'reason') !== undefined}
        />
      </Field>

      <DialogFooter className="items-center">
        <span className="mr-auto hidden text-xs text-muted-foreground sm:block">
          The invoice stays; only this payment stops counting.
        </span>
        <Button type="button" variant="outline" onClick={onDone}>
          Back
        </Button>
        <SubmitButton
          variant="destructive"
          pendingLabel="Reversing..."
          disabled={reason.trim().length < 4}
        >
          Reverse payment
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

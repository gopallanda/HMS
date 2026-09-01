'use client';

import { PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { addPaymentAction, type AddPaymentState } from '@/app/(app)/billing/actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { KbdHint } from '@/components/shared/kbd';
import { MoneyInput } from '@/components/shared/money-input';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';
import {
  expectsReference,
  PAYMENT_MODES,
  PAYMENT_MODE_LABEL,
  type PaymentMode,
} from '@/lib/billing';
import { cn } from '@/lib/cn';
import { formatAmount, formatMoney } from '@/lib/utils/money';

/**
 * What the dialog needs to know about the bill it is settling.
 *
 * `balance` is what the screen believed when it rendered. It seeds the amount
 * and nothing else -- add_payment re-reads the real figure under a row lock and
 * refuses anything larger, naming the true balance. A second cashier may have
 * collected in the meantime and this component must not pretend otherwise.
 */
export type CollectBalanceTarget = {
  invoiceId: string;
  invoiceNo: string;
  patientName: string;
  balance: number;
};

/**
 * Collect a balance on an invoice that already exists.
 *
 * ONE dialog, opened from three places (the invoice list, the PAYMENT DUE
 * badge on the front-desk queue, and the patient money panel), because they
 * are three views of the same act and three copies of this form would be three
 * sets of wording to keep in step.
 *
 * Keyboard-first (CLAUDE.md 7): focus lands on the amount with the seeded
 * balance selected so typing replaces it, Alt+1..4 picks the mode, Enter
 * submits, Escape closes. Radix handles Escape and the focus trap.
 */
export function CollectBalanceDialog({
  target,
  onClose,
}: {
  target: CollectBalanceTarget;
  onClose: () => void;
}) {
  const [state, action] = useActionState<AddPaymentState, FormData>(addPaymentAction, IDLE);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [amount, setAmount] = useState(() => formatAmount(target.balance));
  const [reference, setReference] = useState('');
  const amountInput = useRef<HTMLInputElement>(null);

  /**
   * Client-generated (CLAUDE.md 7), minted once per open dialog. A double
   * click, or a resubmit after the connection drops mid-POST, then banks the
   * money once: add_payment sees the payment id already exists and returns the
   * invoice as it stands.
   */
  const paymentId = useMemo(() => crypto.randomUUID(), []);

  const collected = state.status === 'success' && state.invoice !== undefined;

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
  }, [state]);

  // Alt is not a typing modifier, so the mode keys work from inside the amount
  // field -- which is where the cursor is for the whole life of this dialog.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < PAYMENT_MODES.length) {
        event.preventDefault();
        setMode(PAYMENT_MODES[index]);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Radix would focus the first tabbable element, which is the close
          // button. The amount is the only field anybody wants.
          event.preventDefault();
          amountInput.current?.focus();
          amountInput.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {collected ? `Collected on ${target.invoiceNo}` : `Collect on ${target.invoiceNo}`}
          </DialogTitle>
          <DialogDescription>
            {target.patientName} &middot; {formatMoney(target.balance)} outstanding when this
            screen loaded. The counter re-checks it before recording anything.
          </DialogDescription>
        </DialogHeader>

        {collected ? (
          /* The receipt is offered, never printed for them: a payment taken on
             a phone in a ward does not want the counter roll to start moving. */
          <div className="grid gap-4">
            <FormMessage state={state} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button asChild>
                <Link href={`/print/receipt/${target.invoiceId}?autoprint=0`}>
                  <PrinterIcon data-icon="inline-start" />
                  Receipt
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            action={action}
            className="grid gap-4"
            // Enter submits (CLAUDE.md 7). The browser will NOT do this for us:
            // implicit submission is only offered to a form with a single text
            // input, and this one has an amount and a reference. Without it the
            // fastest keyboard path through the dialog ends at a mouse.
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              const target = event.target as HTMLElement;
              if (target instanceof HTMLTextAreaElement) return;
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }}
          >
            <input type="hidden" name="invoice_id" value={target.invoiceId} />
            <input type="hidden" name="payment_id" value={paymentId} />
            <input type="hidden" name="mode" value={mode} />

            <FormMessage state={state} />

            <Field
              label="Payment mode"
              htmlFor="balance-mode"
              error={fieldError(state, 'mode')}
            >
              <div
                id="balance-mode"
                role="group"
                className="flex items-stretch gap-1 rounded-lg bg-muted p-1"
              >
                {PAYMENT_MODES.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    onClick={() => setMode(option)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm transition-all focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:py-1.5',
                      mode === option
                        ? 'bg-background font-medium text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {PAYMENT_MODE_LABEL[option]}
                    <span className="hidden text-[10px] opacity-60 lg:inline">Alt+{index + 1}</span>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Amount collected"
                htmlFor="balance-amount"
                error={fieldError(state, 'amount')}
                hint="Less than the balance is a part payment."
              >
                <MoneyInput
                  ref={amountInput}
                  id="balance-amount"
                  name="amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-12 text-2xl font-bold md:h-12 md:text-2xl"
                  aria-invalid={fieldError(state, 'amount') !== undefined}
                />
              </Field>

              <Field
                label="Reference"
                htmlFor="balance-reference"
                error={fieldError(state, 'reference')}
                hint={expectsReference(mode) ? 'UPI or approval code.' : 'Optional.'}
              >
                <Input
                  id="balance-reference"
                  name="reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  maxLength={80}
                  autoComplete="off"
                  className="h-12 md:h-12"
                  placeholder={expectsReference(mode) ? 'Txn id' : ''}
                />
              </Field>
            </div>

            <DialogFooter className="items-center">
              <span className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <KbdHint keys={['Alt', '1-4']}>mode</KbdHint>
                <KbdHint keys="Esc">close</KbdHint>
              </span>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Recording...">Record payment</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { CircleSlashIcon } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { cancelVisitAction } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
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
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE } from '@/lib/action-state';
import { cn } from '@/lib/cn';

/**
 * The two answers, in the order they should be read. Retain first: it is what
 * happens on almost every cancellation, and it is the one that moves nothing.
 */
const MONEY_OPTIONS = [
  {
    value: 'retain' as const,
    label: 'The hospital keeps it',
    note: 'Nothing is refunded. The bill and its receipt stay exactly as they are.',
  },
  {
    value: 'refund' as const,
    label: 'Refund it and void the bill',
    note: 'The invoice is voided and the payment reversed. Hand the cash back at the counter.',
  },
];

/**
 * "Cancel visit" -- the front-desk act CLAUDE.md always described and nothing
 * implemented.
 *
 * A typed reason, not a confirm dialog (CLAUDE.md 7). "Are you sure?" is
 * answered yes by reflex, and this retires a token somebody in the waiting
 * room may be holding a printed slip for.
 *
 * Deliberately NOT on the doctor's queue. A doctor who is not going to see
 * somebody marks them complete; taking a patient off the board, voiding their
 * bill and retiring their number is a decision about money and a queue, which
 * is the front desk's.
 */
export function CancelVisitDialog({
  visitId,
  visitNo,
  patientName,
  tokenNo,
  canRefund = false,
  trigger,
}: {
  visitId: string;
  visitNo: string;
  patientName: string;
  tokenNo: number;
  /**
   * billing.void. Decides whether the REFUND option is on offer at all
   * (20260923090000).
   *
   * Without it there is no choice to make and none is shown: the visit is
   * cancelled, anything already collected stays collected, and one sentence
   * says so. Registration takes the consultation fee in the same transaction
   * that creates the visit, so almost every cancellation at this desk is of a
   * visit that has been paid for -- making this a question would put a decision
   * on the fast path that the person answering it cannot act on either way.
   */
  canRefund?: boolean;
  /** Rendered as the button, so the queue and the repair list can word it. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(cancelVisitAction, IDLE);
  const [reason, setReason] = useState('');
  const [money, setMoney] = useState<'retain' | 'refund'>('retain');

  // Closed during render rather than in an effect, the same way TransferDialog
  // does it: an effect repaints the filled-in dialog once over the refreshed
  // queue before it goes, which reads as "did that work?".
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.status === 'success') {
      setOpen(false);
      setReason('');
      setMoney('retain');
    }
  }

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        {trigger ?? (
          <>
            <CircleSlashIcon data-icon="inline-start" />
            Cancel
          </>
        )}
      </Button>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel {visitNo}?</DialogTitle>
          <DialogDescription asChild>
            <div className="grid gap-1 text-sm">
              <span>
                {patientName} &middot; token {tokenNo}
              </span>
              <span>
                Token {tokenNo} is retired, not returned to the pool &mdash; somebody may be
                holding the printed slip. A bill with nothing collected on it is voided, its
                number stays used, and its charges go back to the visit.
              </span>
              {canRefund ? null : (
                <span>
                  Anything already paid stays paid: the hospital keeps it and the receipt goes
                  on being a true record of it. A refund is a billing-counter act.
                </span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="visit_id" value={visitId} />
          {/* Always posted, so a dialog with no choice on it still states its
              answer rather than relying on a schema default. */}
          {canRefund ? null : <input type="hidden" name="money" value="retain" />}

          <FormMessage state={state} />

          <Field
            label="Why is this visit being cancelled?"
            htmlFor={`cancel-reason-${visitId}`}
            error={fieldError(state, 'reason')}
            hint="Kept forever. Be specific: 'patient left without waiting', not 'cancelled'."
            required
          >
            <Textarea
              id={`cancel-reason-${visitId}`}
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={200}
              autoFocus
              placeholder="Patient left without waiting to be seen"
              aria-invalid={fieldError(state, 'reason') !== undefined}
            />
          </Field>

          {/* Only for somebody who holds billing.void, because only they can
              act on either answer. `retain` is first and is the default: it is
              the ordinary walk-out, and the option that moves money should
              never be the one a tired clerk lands on by pressing Enter. */}
          {canRefund ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                Money already collected on this visit
              </legend>
              <div className="grid gap-2">
                {MONEY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'grid cursor-pointer gap-0.5 rounded-lg border px-3 py-2.5 transition has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                      money === option.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="money"
                        value={option.value}
                        checked={money === option.value}
                        onChange={() => setMoney(option.value)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors',
                          money === option.value ? 'border-primary' : 'border-input',
                        )}
                      >
                        {money === option.value ? (
                          <span className="size-2 rounded-full bg-primary" />
                        ) : null}
                      </span>
                      <span className="text-sm font-medium">{option.label}</span>
                    </span>
                    <span className="pl-7 text-xs text-muted-foreground">{option.note}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Ignored when nothing has been collected &mdash; that bill is voided either
                way.
              </p>
            </fieldset>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep the visit
            </Button>
            <SubmitButton
              variant="destructive"
              pendingLabel="Cancelling..."
              disabled={reason.trim().length < 5}
            >
              Cancel visit
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

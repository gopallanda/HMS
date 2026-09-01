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
  trigger,
}: {
  visitId: string;
  visitNo: string;
  patientName: string;
  tokenNo: number;
  /** Rendered as the button, so the queue and the repair list can word it. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(cancelVisitAction, IDLE);
  const [reason, setReason] = useState('');

  // Closed during render rather than in an effect, the same way TransferDialog
  // does it: an effect repaints the filled-in dialog once over the refreshed
  // queue before it goes, which reads as "did that work?".
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.status === 'success') {
      setOpen(false);
      setReason('');
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
                holding the printed slip. An unpaid bill on this visit is voided, its number
                stays used, and its charges go back to the visit. If money has already been
                collected the cancellation is refused: reverse the payment at the counter first.
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="visit_id" value={visitId} />

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

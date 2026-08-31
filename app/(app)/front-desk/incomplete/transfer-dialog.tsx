'use client';

import { ArrowRightLeftIcon } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { transferVisitAction } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { KbdHint } from '@/components/shared/kbd';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fieldError, IDLE } from '@/lib/action-state';

export type TransferDoctor = { id: string; full_name: string; department_id: string | null };

/**
 * "Transfer patient" -- the ONLY way a visit's doctor changes after
 * registration (block 7.1).
 *
 * Deliberately a dialog with a required reason rather than an editable select
 * on the row. Changing who a patient is waiting for moves them to the back of
 * somebody else's queue and retires a token that has already been printed and
 * handed over; that is an event, not a correction, and the screen should say
 * so before it happens.
 */
export function TransferDialog({
  visitId,
  patientName,
  currentDoctor,
  doctors,
  trigger,
}: {
  visitId: string;
  patientName: string;
  currentDoctor: string | null;
  doctors: TransferDoctor[];
  /** Rendered as the button. Lets the queue and the repair list word it. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(transferVisitAction, IDLE);
  const [doctorId, setDoctorId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  // Closing is done during render rather than in an effect: an effect would
  // paint the filled-in dialog once more over the refreshed queue before it
  // disappeared, which reads as "did it work?".
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.status === 'success') {
      setOpen(false);
      setDoctorId('');
    }
  }

  // The toast IS an external system, so it belongs in an effect.
  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
  }, [state]);

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {trigger ?? (
          <>
            <ArrowRightLeftIcon data-icon="inline-start" />
            Transfer
          </>
        )}
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer {patientName}</DialogTitle>
          <DialogDescription>
            {currentDoctor ? `Currently with ${currentDoctor}. ` : 'No doctor set. '}
            They will be given a new token at the back of the new doctor&apos;s queue. The old
            token is retired, not reused.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={action} onKeyDown={onFormKeyDown} className="grid gap-4">
          <input type="hidden" name="visit_id" value={visitId} />
          <input type="hidden" name="doctor_id" value={doctorId} />
          <input type="hidden" name="department_id" value="" />

          <FormMessage state={state} />

          <Field
            label="Move to"
            htmlFor={`transfer-doctor-${visitId}`}
            required
            error={fieldError(state, 'doctor_id')}
            hint="The department follows the doctor."
          >
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger id={`transfer-doctor-${visitId}`} className="h-10 w-full">
                <SelectValue placeholder="Choose a doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Why"
            htmlFor={`transfer-reason-${visitId}`}
            required
            error={fieldError(state, 'reason')}
            hint="Recorded against your name. Somebody will read this in six weeks."
          >
            <Input
              id={`transfer-reason-${visitId}`}
              name="reason"
              maxLength={200}
              placeholder="Dr Rao left early; patient moved to Dr Iyer"
              aria-invalid={fieldError(state, 'reason') !== undefined}
            />
          </Field>

          <DialogFooter className="items-center">
            <span className="mr-auto hidden items-center gap-4 sm:flex">
              <KbdHint keys={['Ctrl', 'Enter']} always>
                transfer
              </KbdHint>
              <KbdHint keys="Esc" always>
                close
              </KbdHint>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Moving..." disabled={doctorId === ''}>
              Transfer patient
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

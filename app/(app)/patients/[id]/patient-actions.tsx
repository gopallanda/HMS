'use client';

import { RotateCcwIcon, SquarePenIcon, UserRoundXIcon } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { setPatientRemoved, updatePatient } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage, Notice } from '@/components/shared/form-message';
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
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE, type ActionState } from '@/lib/action-state';
import { GENDERS, GENDER_LABEL, type Gender } from '@/lib/patients';

export type EditablePatient = {
  id: string;
  mrn: string;
  full_name: string;
  dob: string;
  gender: Gender;
  phone: string | null;
  address: string | null;
  deleted_at: string | null;
};

/**
 * The buttons on a patient record that write something.
 *
 * Split from the page so the record itself stays a Server Component: only the
 * two dialogs need to be interactive, and everything they need arrives as
 * props (CLAUDE.md 7).
 */
export function PatientActions({
  patient,
  canEdit,
  canRemove,
}: {
  patient: EditablePatient;
  canEdit: boolean;
  canRemove: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const removed = patient.deleted_at !== null;

  return (
    <>
      {canEdit && !removed ? (
        <Button variant="outline" onClick={() => setEditing(true)}>
          <SquarePenIcon data-icon="inline-start" />
          Edit
        </Button>
      ) : null}

      {canRemove ? (
        removed ? (
          <RestoreButton patient={patient} />
        ) : (
          <Button variant="outline" onClick={() => setRemoving(true)}>
            <UserRoundXIcon data-icon="inline-start" />
            Remove
          </Button>
        )
      ) : null}

      {editing ? <EditDialog patient={patient} onClose={() => setEditing(false)} /> : null}
      {removing ? <RemoveDialog patient={patient} onClose={() => setRemoving(false)} /> : null}
    </>
  );
}

function EditDialog({ patient, onClose }: { patient: EditablePatient; onClose: () => void }) {
  const [state, action] = useActionState<ActionState, FormData>(updatePatient, IDLE);
  const [gender, setGender] = useState<Gender>(patient.gender);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Correct this record</DialogTitle>
          <DialogDescription>
            {patient.mrn} is allocated by the database and cannot be changed here.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={action} onKeyDown={onFormKeyDown} className="grid gap-4">
          <input type="hidden" name="id" value={patient.id} />
          <input type="hidden" name="gender" value={gender} />

          <FormMessage state={state} />

          {/* Said before the name is edited rather than after, because a
              corrected spelling that does not appear on last month's bill looks
              like a save that half-worked. It is deliberate: invoices carry
              patient_name_snapshot (CLAUDE.md 4). */}
          <Notice>
            Invoices already raised keep the name they were printed with. Correcting a spelling here
            changes this record and future bills, never a bill somebody is already holding.
          </Notice>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Patient name"
              htmlFor="edit-name"
              error={fieldError(state, 'full_name')}
              required
            >
              <Input
                id="edit-name"
                name="full_name"
                defaultValue={patient.full_name}
                maxLength={120}
                required
                autoFocus
                autoComplete="off"
                aria-invalid={fieldError(state, 'full_name') !== undefined}
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="edit-phone"
              error={fieldError(state, 'phone')}
              hint="How this patient is found next time."
            >
              <Input
                id="edit-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={patient.phone ?? ''}
                placeholder="+91 98450 11223"
                autoComplete="off"
                aria-invalid={fieldError(state, 'phone') !== undefined}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date of birth" htmlFor="edit-dob" error={fieldError(state, 'dob')}>
              <Input
                id="edit-dob"
                name="dob"
                type="date"
                defaultValue={patient.dob}
                aria-invalid={fieldError(state, 'dob') !== undefined}
              />
            </Field>

            <Field
              label="or age in years"
              htmlFor="edit-age"
              error={fieldError(state, 'age_years')}
              hint="Clear the date first — a real date always wins."
            >
              <Input
                id="edit-age"
                name="age_years"
                inputMode="numeric"
                maxLength={3}
                placeholder="42"
                autoComplete="off"
                aria-invalid={fieldError(state, 'age_years') !== undefined}
              />
            </Field>

            <Field label="Gender" htmlFor="edit-gender" error={fieldError(state, 'gender')} required>
              <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
                <SelectTrigger id="edit-gender" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {GENDER_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Address" htmlFor="edit-address" error={fieldError(state, 'address')}>
            <Textarea
              id="edit-address"
              name="address"
              rows={2}
              maxLength={300}
              defaultValue={patient.address ?? ''}
              autoComplete="off"
            />
          </Field>

          <DialogFooter className="items-center">
            <span className="mr-auto hidden items-center gap-4 sm:flex">
              <KbdHint keys={['Ctrl', 'Enter']} always>
                save
              </KbdHint>
              <KbdHint keys="Esc" always>
                close
              </KbdHint>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Saving...">
              Save corrections
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Removing a duplicate. The MRN is retyped, the same stand-in for a reason
 * field the departments screen uses -- there is no deleted_reason column, and
 * a destructive action still has to be deliberate (CLAUDE.md 7).
 */
function RemoveDialog({ patient, onClose }: { patient: EditablePatient; onClose: () => void }) {
  const [state, action] = useActionState<ActionState, FormData>(setPatientRemoved, IDLE);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {patient.full_name}?</DialogTitle>
          <DialogDescription>
            Nothing is deleted. The record is hidden from search and cannot start a new visit; its
            visits, invoices and notes stay exactly where they are, and a link from an old bill
            still opens it.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={patient.id} />
          <input type="hidden" name="removed" value="true" />

          <FormMessage state={state} />

          <Notice>
            If this is a duplicate of somebody who already has visits on the other record, removing
            it does not move them across. Merging two records is a separate job — ask before you
            remove the one being used.
          </Notice>

          <Field
            label={`Type ${patient.mrn} to confirm`}
            htmlFor="remove-confirm"
            error={fieldError(state, 'confirm')}
            required
          >
            <Input
              id="remove-confirm"
              name="confirm"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={patient.mrn}
              aria-invalid={fieldError(state, 'confirm') !== undefined}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="sm" variant="destructive" pendingLabel="Removing...">
              Remove record
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Putting one back. No confirmation: restoring a record undoes, it does not destroy. */
function RestoreButton({ patient }: { patient: EditablePatient }) {
  const [state, action] = useActionState<ActionState, FormData>(setPatientRemoved, IDLE);

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
    if (state.status === 'error') toast.error(state.message);
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={patient.id} />
      <input type="hidden" name="removed" value="false" />
      <SubmitButton variant="outline" pendingLabel="Restoring...">
        <RotateCcwIcon data-icon="inline-start" />
        Restore record
      </SubmitButton>
    </form>
  );
}

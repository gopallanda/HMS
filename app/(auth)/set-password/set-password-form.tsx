'use client';

import { useActionState } from 'react';

import { setPassword } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';

export function SetPasswordForm() {
  const [state, formAction] = useActionState(setPassword, IDLE);

  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />

      <Field
        label="New password"
        htmlFor="password"
        error={fieldError(state, 'password')}
        hint="At least 8 characters."
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={fieldError(state, 'password') !== undefined}
          required
          autoFocus
        />
      </Field>

      <Field
        label="Type it again"
        htmlFor="confirm"
        error={fieldError(state, 'confirm')}
        required
      >
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={fieldError(state, 'confirm') !== undefined}
          required
        />
      </Field>

      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Saving...">
        Save and continue
      </SubmitButton>
    </form>
  );
}

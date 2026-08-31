'use client';

import { MailCheckIcon } from 'lucide-react';
import { useActionState } from 'react';

import { requestReset } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestReset, IDLE);

  // The success state replaces the form rather than sitting above it. Leaving
  // the field there invites a second submission, which just burns one of the
  // three requests an account gets in an hour.
  if (state.status === 'success') {
    return (
      <div className="grid gap-4">
        <p className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-3 text-sm">
          <MailCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{state.message}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Nothing arriving? Your administrator can reset your password at the desk and hand you a
          new one -- that works whether or not the address on file is still yours.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />

      <Field
        label="Email address"
        htmlFor="contact_email"
        error={fieldError(state, 'contact_email')}
        required
      >
        <Input
          id="contact_email"
          name="contact_email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@example.com"
          aria-invalid={fieldError(state, 'contact_email') !== undefined}
          required
          autoFocus
        />
      </Field>

      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Sending...">
        Send a reset link
      </SubmitButton>
    </form>
  );
}

'use client';

import { useActionState } from 'react';

import { signUp } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';

export function SignupForm() {
  const [state, formAction] = useActionState(signUp, IDLE);

  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />

      <Field
        label="Hospital name"
        htmlFor="hospital_name"
        error={fieldError(state, 'hospital_name')}
        required
      >
        <Input
          id="hospital_name"
          name="hospital_name"
          autoComplete="organization"
          placeholder="Sunrise Multispeciality Hospital"
          aria-invalid={fieldError(state, 'hospital_name') !== undefined}
          required
          autoFocus
        />
      </Field>

      <Field
        label="Your name"
        htmlFor="full_name"
        error={fieldError(state, 'full_name')}
        required
      >
        <Input
          id="full_name"
          name="full_name"
          autoComplete="name"
          placeholder="Dr. Anjali Rao"
          aria-invalid={fieldError(state, 'full_name') !== undefined}
          required
        />
      </Field>

      <Field label="Email" htmlFor="email" error={fieldError(state, 'email')} required>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@hospital.in"
          aria-invalid={fieldError(state, 'email') !== undefined}
          required
        />
      </Field>

      <Field
        label="Password"
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
        />
      </Field>

      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Creating...">
        Create hospital
      </SubmitButton>
    </form>
  );
}

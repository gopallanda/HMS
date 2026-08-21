'use client';

import { useActionState } from 'react';

import { signIn } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signIn, IDLE);

  return (
    <form action={formAction} className="grid gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FormMessage state={state} />

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
          // Focus lands here on load: this screen is the first keystroke of
          // every shift (CLAUDE.md 7).
          autoFocus
        />
      </Field>

      <Field label="Password" htmlFor="password" error={fieldError(state, 'password')} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={fieldError(state, 'password') !== undefined}
          required
        />
      </Field>

      <SubmitButton className="mt-1 w-full" size="lg" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  );
}

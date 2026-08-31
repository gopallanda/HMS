'use client';

import Link from 'next/link';
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
    <form action={formAction} className="grid gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FormMessage state={state} />

      {/*
        A username, not an email. Staff are handed one at the desk on a slip of
        paper -- there is no invitation email in this product, because in a
        40-bed hospital most of the people who need to sign in do not have a
        work mailbox to invite.

        Email is still accepted for whoever created the hospital through
        /signup, which is why the label says both.
      */}
      <Field
        label="Username"
        htmlFor="identifier"
        error={fieldError(state, 'identifier')}
        hint="The name on the slip your administrator gave you."
        required
      >
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="pavan.kumar"
          aria-invalid={fieldError(state, 'identifier') !== undefined}
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

      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>

      <Link
        href="/forgot-password"
        className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Forgotten your password?
      </Link>
    </form>
  );
}

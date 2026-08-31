'use client';

import { Field } from '@/components/shared/field';
import { Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { MIN_PASSWORD_LENGTH } from '@/lib/credentials';

/**
 * The two password boxes, shared by every screen that sets one: the forced
 * change after a temporary password, and the reset from an emailed link.
 *
 * One component rather than two copies, for the same reason lib/credentials.ts
 * is one module: a second implementation drifts, and the symptom is a rule that
 * holds on one screen and not the other.
 *
 * The confirmation box is not ceremony. On both of these screens the person
 * has nothing to fall back on if they mistype -- one is holding a password
 * that is about to stop working, the other has just spent a single-use link.
 */
export function PasswordFields({ state }: { state: ActionState }) {
  return (
    <>
      <Field
        label="New password"
        htmlFor="password"
        error={fieldError(state, 'password')}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={fieldError(state, 'password') !== undefined}
          required
          autoFocus
        />
      </Field>

      <Field label="Type it again" htmlFor="confirm" error={fieldError(state, 'confirm')} required>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={fieldError(state, 'confirm') !== undefined}
          required
        />
      </Field>
    </>
  );
}

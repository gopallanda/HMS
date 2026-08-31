'use client';

import { useActionState } from 'react';

import { resetPassword } from './actions';
import { PasswordFields } from '../../change-password/password-fields';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { IDLE } from '@/lib/action-state';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPassword, IDLE);

  return (
    <form action={formAction} className="grid gap-4">
      {/* The token came in on the path, not a query string. It rides here in a
          hidden field so the POST carries it without ever appearing in a URL
          the browser will log, sync or leak in a Referer header. */}
      <input type="hidden" name="token" value={token} />

      <FormMessage state={state} />
      <PasswordFields state={state} />

      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Saving...">
        Save password
      </SubmitButton>
    </form>
  );
}

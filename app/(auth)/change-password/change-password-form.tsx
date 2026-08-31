'use client';

import { useActionState } from 'react';

import { changePassword } from './actions';
import { PasswordFields } from './password-fields';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { IDLE } from '@/lib/action-state';

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePassword, IDLE);

  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />
      <PasswordFields state={state} />
      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Saving...">
        Save and continue
      </SubmitButton>
    </form>
  );
}

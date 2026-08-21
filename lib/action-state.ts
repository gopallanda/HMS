/**
 * The shape every Server Action returns to a form.
 *
 * Shared by client and server, like the Zod schemas next to it: the form reads
 * `fieldErrors` to mark inputs and `message` to show a banner. Nothing here is
 * allowed to swallow a failure into a silent no-op (CLAUDE.md 7).
 */

import { z } from 'zod';

export type FieldErrors = Record<string, string[] | undefined>;

export type ActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: FieldErrors }
  | { status: 'success'; message: string };

export const IDLE: ActionState = { status: 'idle' };

export function failure(message: string, fieldErrors?: FieldErrors): ActionState {
  return { status: 'error', message, fieldErrors };
}

export function success(message: string): ActionState {
  return { status: 'success', message };
}

/**
 * A Zod failure, rendered for a form. The banner stays generic because the
 * useful detail is already sitting under each field.
 */
export function invalid(error: z.ZodError): ActionState {
  const flat = z.flattenError(error);
  return {
    status: 'error',
    message: flat.formErrors[0] ?? 'Check the highlighted fields.',
    fieldErrors: flat.fieldErrors as FieldErrors,
  };
}

export function fieldError(state: ActionState, name: string): string | undefined {
  if (state.status !== 'error') return undefined;
  return state.fieldErrors?.[name]?.[0];
}

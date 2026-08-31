/**
 * Staff accounts: provisioning, signing in, changing and resetting a password.
 *
 * Credentials are handed over at the desk. There is no invitation email and no
 * email round trip before somebody's first shift -- staff in a small Indian
 * hospital do not have work mailboxes, and an invitation that assumes they do
 * is a flow that never completes.
 *
 * The one email this product sends is a password reset, to the contact_email
 * captured at provisioning precisely so an account can recover itself without
 * an administrator.
 */

import { z } from 'zod';

import {
  CONTACT_EMAIL_MESSAGE,
  MIN_PASSWORD_LENGTH,
  normaliseUsername,
  validateContactEmail,
} from '@/lib/credentials';

/**
 * The recovery mailbox. Required at creation, and it may not be one of the
 * synthetic sign-in addresses -- an account whose contact address is its own
 * login address can never be recovered, because nothing is listening at the
 * other end.
 */
export const contactEmail = z
  .string({ error: CONTACT_EMAIL_MESSAGE.empty })
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const problem = validateContactEmail(value);
    if (problem) ctx.addIssue({ code: 'custom', message: CONTACT_EMAIL_MESSAGE[problem] });
  });

export const provisionAccountSchema = z.object({
  staff_id: z.uuid('Invalid staff record.'),
  contact_email: contactEmail,
});

export type ProvisionAccountInput = z.infer<typeof provisionAccountSchema>;

export const resetStaffPasswordSchema = z.object({
  account_id: z.uuid('Invalid account.'),
});

/**
 * Revoking access. A typed name, like every other destructive action in this
 * app: a confirm dialog is a reflex, typing somebody's name is a decision
 * (CLAUDE.md 7).
 */
export const setAccountEnabledSchema = z.object({
  account_id: z.uuid('Invalid account.'),
  enabled: z.union([z.literal('true'), z.literal('false')]),
  confirm: z.string().trim(),
});

/**
 * Sign-in.
 *
 * A USERNAME, normally. The person is handed "pavan.kumar" on a slip of paper;
 * the synthetic address it resolves to is an implementation detail of Supabase
 * Auth and is never shown to them.
 *
 * An email address is accepted too, and that is not a hedge: /signup still
 * exists, and whoever creates a hospital does it with their own real address
 * before there is any staff record to hang a username on. Refusing an email
 * here would lock every founder out of the product they just bought. Which
 * kind of identifier this is gets decided by the presence of an '@', in the
 * action -- one field on screen, two resolutions behind it.
 */
export const signInSchema = z.object({
  identifier: z
    .string({ error: 'Enter your username.' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your username.')
    .max(254, 'That is too long to be a username.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type SignInInput = z.infer<typeof signInSchema>;

/** Whether what somebody typed is an email address rather than a username. */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}

export function asUsername(identifier: string): string {
  return normaliseUsername(identifier);
}

/**
 * Choosing a new password, whether forced after a temporary one or chosen
 * freely later.
 *
 * The confirmation field is not ceremony: for somebody who has only ever held
 * a temporary password, a typo here locks them out of an account they have
 * never really used, and there is nothing to fall back on.
 */
export const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirm: z.string().min(1, 'Type the password again.'),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirm) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirm'],
        message: 'The two passwords do not match.',
      });
    }
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Asking for a reset link.
 *
 * Takes the CONTACT email, not the username: the person who has forgotten how
 * to get in has usually forgotten both, and the mailbox is the thing they can
 * still name. The response is identical whether or not it matches an account.
 */
export const forgotPasswordSchema = z.object({
  contact_email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email address.')
    .max(254, 'That address is too long.'),
});

export const resetPasswordSchema = changePasswordSchema;

/**
 * Sign-in and sign-up. Deliberately thin: the password rules live in Supabase
 * Auth, and duplicating them here would only produce a second, wrong answer.
 */

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Creating an account creates a HOSPITAL: whoever signs up becomes its
 * administrator (see supabase/migrations/20260825090000_provision_hospital.sql).
 * That is why the hospital's name is asked for here rather than in a later
 * setup step -- there is no tenant to hang a setup step on until it exists.
 *
 * The minimum length below is a courtesy that saves a round trip. Supabase is
 * still the authority and will reject a weak password with its own message.
 */
export const signupSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Enter your name.')
    .max(120, 'That name is too long.'),
  hospital_name: z
    .string()
    .trim()
    .min(2, 'Enter the hospital name.')
    .max(160, 'That name is too long.'),
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Choosing a password after an invitation or a reset.
 *
 * The confirmation field is not paranoia: this is the only screen in the app
 * where a typo locks somebody out of an account they have never signed into,
 * so there is nothing to fall back on.
 */
export const setPasswordSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters.'),
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

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

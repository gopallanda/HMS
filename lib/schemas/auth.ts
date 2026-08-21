/**
 * Sign-in. Deliberately thin: the password rules live in Supabase Auth, and
 * duplicating them here would only produce a second, wrong answer.
 */

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginInput = z.infer<typeof loginSchema>;

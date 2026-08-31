/**
 * Moving a waiting patient to another doctor (block 7.1).
 *
 * The reason is required here and again inside transfer_visit(), because an
 * RPC answers a POST without the form. A transfer with no reason is an edit
 * with extra steps, and the reason is the only part of this that is worth
 * anything six weeks later when somebody asks why the patient was moved.
 */

import { z } from 'zod';

import { optionalId, text } from '@/lib/schemas/form';

export const transferSchema = z.object({
  visit_id: z.uuid('That visit is no longer valid.'),
  doctor_id: z.uuid('Choose the doctor to move them to.'),
  department_id: optionalId,
  reason: text('Reason', 5, 200),
});

export type TransferInput = z.infer<typeof transferSchema>;

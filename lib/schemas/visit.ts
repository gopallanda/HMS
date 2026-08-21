/**
 * Starting a visit.
 *
 * A visit is where the doctor, the department and the episode live -- not the
 * patient row (CLAUDE.md 4). The department is optional here because
 * create_visit fills it in from the doctor when the desk leaves it alone,
 * which is what happens on nearly every OPD registration.
 *
 * visit_type is restricted to what the front desk can actually complete today:
 * an IPD admission needs beds and daily charge accrual, which is Phase 3.
 */

import { z } from 'zod';

import { clientId, optionalId } from '@/lib/schemas/form';
import { VISIT_TYPES_AT_DESK } from '@/lib/visits';

export const visitSchema = z.object({
  id: clientId,
  patient_id: z.uuid('Search for a patient first.'),
  /**
   * Required at the desk even though the column is nullable: an OPD visit with
   * no doctor appears in nobody's queue and raises no consultation charge. The
   * column stays nullable for the emergency case, where a patient is registered
   * before anyone knows who will see them.
   */
  doctor_id: z.uuid('Choose a doctor.'),
  department_id: optionalId,
  visit_type: z.enum(VISIT_TYPES_AT_DESK, { error: 'Choose a visit type.' }),
});

export type VisitInput = z.infer<typeof visitSchema>;

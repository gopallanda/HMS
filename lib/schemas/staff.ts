/**
 * Staff.
 *
 * Two rules worth stating out loud:
 *
 *  - Only doctors carry a consultation fee. Phase 1 seeds a consultation
 *    charge_item from this number, so a nurse left holding a stale 450 from
 *    when they were entered as a doctor would quietly raise a charge. The fee
 *    is therefore forced to 0 for every other role instead of merely hidden.
 *
 *  - A doctor needs a registration number. It has to appear on prescriptions,
 *    and it is far cheaper to demand it now than to chase 40 doctors later.
 */

import { z } from 'zod';

import { checkbox, clientId, money, optionalId, optionalText, phone, text } from '@/lib/schemas/form';
import { APP_ROLES, chargesConsultationFee } from '@/lib/roles';

export const staffSchema = z
  .object({
    id: clientId,
    full_name: text('Name', 2, 120),
    role: z.enum(APP_ROLES, { error: 'Choose a role.' }),
    department_id: optionalId,
    phone: phone(),
    reg_no: optionalText('Registration number', 60),
    consultation_fee: money('Consultation fee'),
    is_active: checkbox,
  })
  .transform((staff) => ({
    ...staff,
    consultation_fee: chargesConsultationFee(staff.role) ? staff.consultation_fee : 0,
  }))
  .superRefine((staff, ctx) => {
    if (staff.role === 'doctor' && !staff.reg_no) {
      ctx.addIssue({
        code: 'custom',
        path: ['reg_no'],
        message: 'A doctor needs a registration number -- it prints on prescriptions.',
      });
    }
  });

export type StaffInput = z.infer<typeof staffSchema>;

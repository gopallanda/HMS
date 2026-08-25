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

/**
 * Issuing a login to an existing staff record.
 *
 * The role here is the MEMBERSHIP role -- what the person's JWT will carry and
 * what RLS will enforce -- which is deliberately not the same field as the
 * staff role above. The staff role is their job; this is their access. The
 * seeded owner is a doctor on the staff list and a super_admin on her token,
 * and saveStaff goes out of its way never to conflate the two (CLAUDE.md 5).
 *
 * super_admin is absent from the options on purpose: it is meant for whoever
 * runs the platform, and no hospital administrator may grant it. The RPC
 * refuses it too -- this list only decides what the form offers.
 */
export const INVITABLE_ROLES = APP_ROLES.filter((role) => role !== 'super_admin');

export const staffInviteSchema = z.object({
  staff_id: z.uuid('Invalid staff record.'),
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  role: z.enum(INVITABLE_ROLES as [typeof INVITABLE_ROLES[number], ...typeof INVITABLE_ROLES], {
    error: 'Choose what this login may do.',
  }),
});

export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

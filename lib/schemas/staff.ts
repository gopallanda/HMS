/**
 * Staff.
 *
 * A staff record is a PERSON WHO WORKS HERE. That is the whole definition, and
 * it deliberately no longer implies a login: after block 1 a cleaner is a staff
 * record with a role, a department, a roster and no credentials at all.
 *
 * Three rules worth stating out loud:
 *
 *  - Role and department are INDEPENDENT and both live on this form. Role is
 *    what the person does, department is where they sit. Nothing derives one
 *    from the other, and permissions never key off a department.
 *
 *  - Only doctors carry a consultation fee. create_visit seeds a consultation
 *    charge from this number, so a nurse left holding a stale 450 from when
 *    they were entered as a doctor would quietly raise a charge. The fee is
 *    forced to 0 for every other role rather than merely hidden -- which means
 *    the schema has to know which role is the doctor, and it does that by role
 *    CODE, not by the legacy enum.
 *
 *  - A doctor needs a registration number. It prints on prescriptions, and it
 *    is far cheaper to demand it now than to chase forty doctors later.
 */

import { z } from 'zod';

import {
  checkbox,
  clientId,
  money,
  optionalId,
  optionalText,
  phone,
  text,
} from '@/lib/schemas/form';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract'] as const;

export type EmploymentTypeValue = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentTypeValue, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
};

/**
 * The role code that bills a consultation.
 *
 * A constant rather than a lookup, because it is the only place the product
 * still cares what a role is CALLED: create_visit prices a visit from
 * staff.consultation_fee and only a doctor has one. A custom role that should
 * also bill consultations is block 4's problem, and it will be answered with a
 * flag on the role rather than by widening this string.
 */
export const DOCTOR_ROLE_CODE = 'doctor';

export function chargesConsultationFee(roleCode: string | null | undefined): boolean {
  return roleCode === DOCTOR_ROLE_CODE;
}

/**
 * A payroll or badge number. Optional, but strongly preferred: it becomes the
 * stem of the username when an account is provisioned, and a username built
 * from a badge number neither collides nor publishes who works here.
 */
const employeeCode = z
  .string()
  .trim()
  .max(30, 'The employee code must be 30 characters or fewer.')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine(
    (value) => value === null || /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value),
    'Use letters, digits, dots, hyphens and underscores.',
  );

/**
 * The form posts a role id; only the ACTION knows which code that id names, so
 * the doctor-specific rules cannot live in the object schema alone. The schema
 * is therefore built per submission with the code the action just looked up --
 * one schema, two call sites, no second implementation of the rules.
 */
export function staffSchema(roleCode: string | null) {
  const isDoctor = chargesConsultationFee(roleCode);

  return z
    .object({
      id: clientId,
      full_name: text('Name', 2, 120),
      role_id: z.uuid('Choose a role.'),
      department_id: optionalId,
      employee_code: employeeCode,
      employment_type: z.enum(EMPLOYMENT_TYPES, { error: 'Choose an employment type.' }),
      phone: phone(),
      reg_no: optionalText('Registration number', 60),
      consultation_fee: money('Consultation fee'),
      /**
       * Only ever narrows. The database stores null for "follow the role" and
       * false for "denied", and never true -- so a role that stops using the
       * software takes its people with it instead of leaving stale copies.
       */
      denied_login: checkbox,
      is_active: checkbox,
    })
    .transform((staff) => ({
      ...staff,
      consultation_fee: isDoctor ? staff.consultation_fee : 0,
      can_login: staff.denied_login ? false : null,
    }))
    .superRefine((staff, ctx) => {
      if (isDoctor && !staff.reg_no) {
        ctx.addIssue({
          code: 'custom',
          path: ['reg_no'],
          message: 'A doctor needs a registration number -- it prints on prescriptions.',
        });
      }
    });
}

export type StaffInput = z.infer<ReturnType<typeof staffSchema>>;

export const staffActivationSchema = z.object({
  id: z.uuid('Invalid staff record.'),
  confirm: z.string().trim(),
});

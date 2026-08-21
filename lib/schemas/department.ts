/**
 * Departments.
 *
 * `code` is what staff type and what appears on reports, so it is normalised to
 * upper case here rather than left to whoever fills the form. Uniqueness is
 * scoped to the hospital in the migration -- two hospitals may both run an
 * ORTHO department (CLAUDE.md 3.1).
 */

import { z } from 'zod';

import { checkbox, clientId, text } from '@/lib/schemas/form';

export const departmentSchema = z.object({
  id: clientId,
  name: text('Department name', 2, 80),
  code: text('Code', 2, 12)
    .toUpperCase()
    .refine(
      (value) => /^[A-Z0-9_]+$/.test(value),
      'Code may only contain letters, digits and underscores.',
    ),
  is_active: checkbox,
});

export type DepartmentInput = z.infer<typeof departmentSchema>;

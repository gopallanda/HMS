'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { departmentSchema } from '@/lib/schemas/department';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Create or rename a department.
 *
 * upsert, not insert: the id is minted in the browser (CLAUDE.md 7), so the
 * same form submitted twice over a flaky clinic connection writes the same row
 * instead of two departments called Orthopaedics.
 */
export async function saveDepartment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('departments.manage');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = departmentSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    code: formData.get('code'),
    is_active: formData.get('is_active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { error } = await supabase.from('departments').upsert(
    {
      id: parsed.data.id,
      hospital_id: session.hospitalId,
      name: parsed.data.name,
      code: parsed.data.code,
      is_active: parsed.data.is_active,
    },
    { onConflict: 'id' },
  );

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${parsed.data.name} saved.`);
}

const deactivateSchema = z.object({
  id: z.uuid('Invalid department.'),
  /** The department code, retyped. Compared against the row on the server. */
  confirm: z.string().trim(),
});

/**
 * Deactivate a department.
 *
 * Nothing here deletes (CLAUDE.md 3.5): visits and charge_items in Phase 1
 * point at departments, and a deleted row would take their history with it.
 *
 * The typed confirmation is the schema's stand-in for a reason field. Neither
 * departments nor staff carries one, and adding a column CLAUDE.md 4 does not
 * list is not a decision to make in passing -- so the destructive action is at
 * least made deliberate rather than one stray click (CLAUDE.md 7).
 */
export async function setDepartmentActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('departments.manage');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = deactivateSchema.safeParse({
    id: formData.get('id'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const activate = formData.get('is_active') === 'true';

  const supabase = await createClient();

  const { data: department, error: readError } = await supabase
    .from('departments')
    .select('name, code, is_active')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (readError) return failure(describeDatabaseError(readError));
  if (!department) return failure('That department no longer exists.');

  if (!activate && parsed.data.confirm.toUpperCase() !== department.code.toUpperCase()) {
    return failure(`Type ${department.code} to confirm.`, {
      confirm: [`Type ${department.code} exactly.`],
    });
  }

  const { error } = await supabase
    .from('departments')
    .update({ is_active: activate })
    .eq('id', parsed.data.id);

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${department.name} ${activate ? 'reactivated' : 'deactivated'}.`);
}

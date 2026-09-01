'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { closeDay } from '@/lib/rpc/billing';
import { closeDaySchema } from '@/lib/schemas/billing';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/utils/money';

/**
 * Close the day.
 *
 * reports.view, the same key that opens the route -- an accountant who may not
 * collect a rupee is exactly the person who counts the drawer at the end of
 * the week.
 *
 * Closing locks nothing. It records that somebody counted, what they counted,
 * and how that compared with the system, which is the whole of what the screen
 * was missing.
 */
export async function closeDayAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('reports.view');
  if (!gate.ok) return failure(gate.message);

  const parsed = closeDaySchema.safeParse({
    date: formData.get('date'),
    declared_cash: formData.get('declared_cash'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data, error } = await closeDay(
    supabase,
    parsed.data.date,
    parsed.data.declared_cash,
    parsed.data.notes,
  );

  if (error) return failure(describeDatabaseError(error));
  if (!data) return failure('The day could not be closed. Nothing was recorded.');

  refresh();

  // The variance is the answer, so it is the message -- not "saved".
  if (Math.abs(data.variance) < 0.005) {
    return success('Closed. The drawer agrees with the system exactly.');
  }

  return success(
    data.variance > 0
      ? `Closed with ${formatMoney(data.variance)} MORE in the drawer than the system recorded.`
      : `Closed with ${formatMoney(Math.abs(data.variance))} SHORT against the system.`,
  );
}

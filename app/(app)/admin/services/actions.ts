'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { serviceSchema } from '@/lib/schemas/service';
import { describeDatabaseError, violates } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/** The unique index in 20260818120000, on (hospital_id, lower(name)). */
const NAME_TAKEN = 'services_hospital_id_lower_name_key';

/**
 * Create or edit a service.
 *
 * upsert, not insert: the id is minted in the browser (CLAUDE.md 7), so the
 * same form submitted twice over a flaky clinic connection writes the same row
 * instead of two services called Dressing.
 *
 * Editing a price is safe by construction. charge_items holds its own copy of
 * description, unit_price, tax_rate and amount, so nothing here can reach a
 * bill that has already been raised -- and the services_audit trigger records
 * who changed the price and when.
 */
export async function saveService(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('settings.manage');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = serviceSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    category: formData.get('category'),
    price: formData.get('price'),
    tax_rate: formData.get('tax_rate'),
    is_active: formData.get('is_active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { error } = await supabase.from('services').upsert(
    {
      id: parsed.data.id,
      hospital_id: session.hospitalId,
      name: parsed.data.name,
      category: parsed.data.category,
      price: parsed.data.price,
      tax_rate: parsed.data.tax_rate,
      is_active: parsed.data.is_active,
    },
    { onConflict: 'id' },
  );

  if (error) {
    // The duplicate belongs under the name field, not only in the banner: the
    // name is what has to change, and the admin is already looking at it.
    if (violates(error, NAME_TAKEN)) {
      return failure(`A service called ${parsed.data.name} already exists.`, {
        name: [`A service called ${parsed.data.name} already exists.`],
      });
    }
    return failure(describeDatabaseError(error));
  }

  refresh();
  return success(`${parsed.data.name} saved.`);
}

const activeSchema = z.object({
  id: z.uuid('Invalid service.'),
  is_active: z.union([z.literal('true'), z.literal('false')]),
});

/**
 * Take a service off the price list, or put it back.
 *
 * No typed confirmation here, unlike departments. CLAUDE.md 7 asks for a typed
 * reason on DESTRUCTIVE actions, and this destroys nothing: charge_items keeps
 * its own copy of every price it ever billed, so deactivating changes only what
 * the counter is offered next. The dialog says exactly that, and a second click
 * puts the row back.
 */
export async function setServiceActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('settings.manage');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = activeSchema.safeParse({
    id: formData.get('id'),
    is_active: formData.get('is_active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const activate = parsed.data.is_active === 'true';
  const supabase = await createClient();

  const { data: service, error: readError } = await supabase
    .from('services')
    .select('name')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (readError) return failure(describeDatabaseError(readError));
  if (!service) return failure('That service no longer exists.');

  const { error } = await supabase
    .from('services')
    .update({ is_active: activate })
    .eq('id', parsed.data.id);

  if (error) return failure(describeDatabaseError(error));

  refresh();
  return success(`${service.name} ${activate ? 'is back on the price list' : 'removed from the price list'}.`);
}

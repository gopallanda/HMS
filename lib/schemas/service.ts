/**
 * Services -- the charge master a bill is built from.
 *
 * Two things worth stating out loud:
 *
 *  - Nothing validated here can alter a bill that already exists. charge_items
 *    snapshots description, unit_price, tax_rate and amount at the moment the
 *    line is raised, with a check that amount = round(qty * unit_price, 2), so
 *    editing a price or deactivating a service moves what the counter will
 *    offer NEXT -- never what a printed invoice says.
 *
 *  - tax_rate defaults to 0 because hospital services are largely GST-exempt
 *    (CLAUDE.md 8). A non-zero rate on a non-pharmacy category is unusual, not
 *    invalid, so the screen hints and the schema accepts it.
 */

import { z } from 'zod';

import { checkbox, clientId, money, percent, text } from '@/lib/schemas/form';
import { SERVICE_CATEGORIES, SERVICE_UNITS } from '@/lib/services';

export const serviceSchema = z.object({
  id: clientId,
  name: text('Service name', 2, 120),
  // Every category, not CREATABLE_SERVICE_CATEGORIES: the form declines to
  // OFFER pharmacy on a new row, but an existing pharmacy line still has to
  // save when somebody edits its price.
  category: z.enum(SERVICE_CATEGORIES, { error: 'Choose a category.' }),
  // Absent from an older client, or from a form field that never rendered, is
  // `each` -- the column default and the answer for most of an OPD day.
  unit: z
    .union([z.enum(SERVICE_UNITS), z.literal(''), z.null(), z.undefined()])
    .transform((value) => (value === '' || value == null ? 'each' : value)),
  price: money('Price'),
  tax_rate: percent('GST rate'),
  is_active: checkbox,
});

export type ServiceInput = z.infer<typeof serviceSchema>;

/**
 * Services -- the charge master.
 *
 * The enum lives in Postgres (public.service_category). This file is the one
 * place the app decides what each category is CALLED and in what order it is
 * offered -- the same arrangement as lib/roles.ts and lib/billing.ts.
 *
 * ServiceCategory is re-exported from the generated database types on purpose:
 * when types/database.ts is regenerated (CLAUDE.md 9 step 4) a category added
 * in SQL but forgotten here becomes a type error in SERVICE_CATEGORY_LABEL
 * rather than a blank group heading at the billing counter.
 *
 * There is deliberately only one label map. The price list and the collect
 * screen's grouped picker both read it, so an admin who edits a category on one
 * screen cannot find it filed under a different word on the other.
 */

import type { Database } from '@/types/database';

export type ServiceCategory = Database['public']['Enums']['service_category'];

/**
 * Display order, not alphabetical and not the enum's own order: consultation
 * and procedures are what an OPD desk bills all day, beds belong to IPD in
 * Phase 3, and `other` is a bucket that should be the last thing anyone reaches
 * for.
 */
export const SERVICE_CATEGORIES = [
  'consultation',
  'procedure',
  'lab',
  'pharmacy',
  'bed',
  'other',
] as const satisfies readonly ServiceCategory[];

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  consultation: 'Consultation',
  procedure: 'Procedure',
  lab: 'Lab',
  pharmacy: 'Pharmacy',
  bed: 'Bed',
  other: 'Other',
};

/**
 * Whether a non-zero GST rate is the expected case for a category.
 *
 * Hospital services are largely GST-exempt; pharmacy sales are taxable
 * (CLAUDE.md 8). The price list uses this to HINT, never to block: some
 * procedures genuinely are taxable, and the hospital's accountant knows their
 * business better than this file does.
 */
export function expectsTax(category: ServiceCategory): boolean {
  return category === 'pharmacy';
}

/**
 * Whether the doctor's own fee overrides this row's price.
 *
 * services.price carries the comment "For a consultation the doctor
 * consultation_fee wins" and create_visit seeds the consultation charge from
 * staff.consultation_fee (CLAUDE.md 4). An admin who edits the consultation
 * price here and sees bills unchanged will report it as a bug, so the price
 * list says so on the row instead.
 */
export function priceIsAdvisory(category: ServiceCategory): boolean {
  return category === 'consultation';
}

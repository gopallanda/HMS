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

/**
 * Categories offered when a NEW row is created.
 *
 * Everything except pharmacy. A drug's price belongs to a batch -- purchase MRP
 * differs between batches of the same molecule, stock is an append-only ledger
 * and dispensing is FEFO (CLAUDE.md 3.4) -- so a fixed price typed against a
 * molecule here is a price that is wrong within a month, and a price list that
 * invites one teaches a pattern Phase 2 has to contradict.
 *
 * The enum value is NOT going away: charge_items.source_module reports on it,
 * rows already exist carrying it, and Phase 2 dispensing will write charge
 * lines in it with the unit price taken from the batch. It is only withheld
 * from the create form. An existing pharmacy row still edits normally -- see
 * categoryOptions().
 */
export const CREATABLE_SERVICE_CATEGORIES = SERVICE_CATEGORIES.filter(
  (category) => category !== 'pharmacy',
) as readonly ServiceCategory[];

/**
 * The category list a particular row may choose from: the creatable ones, plus
 * whatever this row already is. Editing the price of an existing pharmacy line
 * must not silently re-file it under `other` because the Select could not show
 * its own value.
 */
export function categoryOptions(current: ServiceCategory): readonly ServiceCategory[] {
  return CREATABLE_SERVICE_CATEGORIES.includes(current)
    ? CREATABLE_SERVICE_CATEGORIES
    : SERVICE_CATEGORIES.filter(
        (category) => category === current || CREATABLE_SERVICE_CATEGORIES.includes(category),
      );
}

/**
 * One line saying what a row in this category IS, shown in the form the moment
 * a category is chosen.
 *
 * The whole module is misread in one specific way -- as if a category took a
 * price ("set Lab to 300") rather than holding rows that each take one. The
 * dropdown is where that misreading starts, so this is where it is answered.
 */
export const SERVICE_CATEGORY_HINT: Record<ServiceCategory, string> = {
  consultation: 'One row per kind of consultation — first visit, follow up, after hours.',
  procedure: 'One row per procedure — dressing, injection, nebulisation, ECG, suturing.',
  lab: 'One row per test — CBC, urine routine, lipid profile. Never one price for “the lab”.',
  pharmacy: 'Being retired here: a drug price belongs to its batch, not to this list.',
  bed: 'One row per ward class, priced per night — General, Semi-private, Private, ICU.',
  other: 'Anything billable that is not clinical — ambulance, certificates, record copies.',
};

export type ServiceUnit = Database['public']['Enums']['service_unit'];

/**
 * What one of something IS.
 *
 * Five values, and the reason there are exactly five is that each one changes
 * how a QUANTITY is read at the counter. Until this column existed the meaning
 * lived in the name ("General Ward - per day"), where nothing could enforce it
 * -- and Phase 3 multiplies a bed rate by length of stay.
 */
export const SERVICE_UNITS = [
  'each',
  'per_day',
  'per_test',
  'per_session',
  'per_hour',
] as const satisfies readonly ServiceUnit[];

export const SERVICE_UNIT_LABEL: Record<ServiceUnit, string> = {
  each: 'Each',
  per_day: 'Per day',
  per_test: 'Per test',
  per_session: 'Per session',
  per_hour: 'Per hour',
};

/**
 * What the unit reads as after a price: "3,000.00 / day".
 *
 * `each` is null rather than "/ each": the overwhelming majority of an OPD day
 * is one-off charges, and suffixing every one of them is noise that hides the
 * four rows where the unit actually matters.
 */
export const SERVICE_UNIT_SUFFIX: Record<ServiceUnit, string | null> = {
  each: null,
  per_day: '/ day',
  per_test: '/ test',
  per_session: '/ session',
  per_hour: '/ hour',
};

/**
 * The unit a new row in this category almost certainly wants.
 *
 * A default, never a rule: a ward billed per hour is unusual, not wrong, and
 * the form leaves the field editable.
 */
export function defaultUnitFor(category: ServiceCategory): ServiceUnit {
  if (category === 'bed') return 'per_day';
  if (category === 'lab') return 'per_test';
  return 'each';
}

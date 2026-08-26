/**
 * Field builders shared by every form schema in this directory.
 *
 * Forms post FormData, so everything arrives as a string. These builders do the
 * string-to-value work once, in the schema, so the same rules apply on the
 * client and on the server (CLAUDE.md 7) instead of the server re-implementing
 * a looser version of them.
 */

import { z } from 'zod';

import { parseMoney } from '@/lib/utils/money';

/** A required, trimmed line of text. */
export function text(label: string, min = 1, max = 200) {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be ${max} characters or fewer.`);
}

/**
 * An optional line of text. Empty becomes null, never '' -- a column that can
 * hold both is a column with two kinds of empty in it.
 */
export function optionalText(label: string, max = 200) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => (value === '' ? null : value))
    .nullable();
}

/** An unchecked checkbox is absent from FormData; a checked one is 'on'. */
export const checkbox = z
  .union([z.boolean(), z.string(), z.undefined(), z.null()])
  .transform((value) => value === true || value === 'on' || value === 'true');

/**
 * Client-generated id (CLAUDE.md 7): the browser mints the uuid, so a form
 * resubmitted after a dropped connection writes the same row instead of a
 * second one.
 */
export const clientId = z.uuid('Invalid record id.');

/** A uuid reference, or null when the select is left on its empty option. */
export const optionalId = z
  .union([z.uuid(), z.literal(''), z.null(), z.undefined()])
  .transform((value) => (value === '' || value == null ? null : value));

/**
 * Money as the operator typed it: "500", "500.00", "1,500", "₹1500".
 * Rejected input becomes a field error, never NaN in a numeric(12,2) column.
 */
export function money(label: string, max = 999_999.99) {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx) => {
      const asString = raw == null ? '' : String(raw).trim();
      const value = asString === '' ? 0 : parseMoney(asString);

      if (value === null) {
        ctx.addIssue({ code: 'custom', message: `${label} must be an amount, like 500 or 500.00.` });
        return z.NEVER;
      }
      if (value < 0) {
        ctx.addIssue({ code: 'custom', message: `${label} cannot be negative.` });
        return z.NEVER;
      }
      if (value > max) {
        ctx.addIssue({ code: 'custom', message: `${label} cannot be more than ${max}.` });
        return z.NEVER;
      }
      return value;
    });
}

/**
 * A percentage, as the operator typed it: "12", "12.5", "12%".
 *
 * Separate from money() because the column is different -- tax_rate is
 * numeric(5,2) with a 0..100 check -- and because 0 is the normal answer here
 * rather than a suspicious one (CLAUDE.md 8: hospital services are exempt).
 */
export function percent(label: string) {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx) => {
      const asString = raw == null ? '' : String(raw).replace('%', '').trim();
      if (asString === '') return 0;

      const value = Number(asString);
      if (!/^\d*\.?\d*$/.test(asString) || !Number.isFinite(value)) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a number, like 0 or 12.` });
        return z.NEVER;
      }
      if (value < 0 || value > 100) {
        ctx.addIssue({ code: 'custom', message: `${label} must be between 0 and 100.` });
        return z.NEVER;
      }
      // numeric(5,2): two decimals is all the column can hold.
      return Math.round(value * 100) / 100;
    });
}

/** Phone numbers are entered by hand and pasted from WhatsApp. Stay permissive. */
export function phone(label = 'Phone') {
  return z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .refine(
      (value) => value === null || /^[0-9+()\-\s]{6,20}$/.test(value),
      `${label} may only contain digits, spaces and + ( ) -.`,
    );
}

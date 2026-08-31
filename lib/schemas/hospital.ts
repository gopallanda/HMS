/**
 * Hospital branding and statutory details.
 *
 * Everything here is printed: the name, address, phone and GSTIN sit on every
 * invoice and receipt, read off the hospitals row rather than hardcoded
 * (CLAUDE.md 7). Bad data here is bad data on a legal document, so the GSTIN
 * is format-checked rather than accepted as free text.
 */

import { z } from 'zod';

import { PRINT_FORMATS } from '@/lib/billing';
import { optionalText, phone, text } from '@/lib/schemas/form';

/**
 * 15 characters: 2 state code, 10 PAN, 1 entity number, 'Z', 1 checksum.
 * Structure only -- the checksum digit is not verified here.
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const hospitalSettingsSchema = z.object({
  name: text('Hospital name', 2, 120),
  address: optionalText('Address', 300),
  phone: phone(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .refine(
      (value) => value === null || GSTIN_PATTERN.test(value),
      'A GSTIN is 15 characters, like 29ABCDE1234F1Z5.',
    ),
  /**
   * Which paper a receipt goes to by default (block 5).
   *
   * It lives in hospitals.settings rather than in a column because it is a
   * preference about hardware, not a fact about the business -- and because
   * the next two things Printing grows (a footer line, a second copy for the
   * counter) belong beside it rather than as two more columns.
   */
  receipt_default: z.enum(PRINT_FORMATS, {
    error: 'Choose the paper this hospital prints receipts on.',
  }),
});

export type HospitalSettingsInput = z.infer<typeof hospitalSettingsSchema>;

/**
 * Logo upload limits. Mirrored in the branding bucket definition
 * (supabase/migrations/20260818110000_storage_branding.sql) -- the bucket is
 * the enforcement, this is the message the admin actually reads.
 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export const LOGO_ACCEPT = LOGO_MIME_TYPES.join(',');

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export type LogoCheck =
  | { ok: true; extension: string }
  | { ok: false; message: string };

/** Runs on the client before upload and again in the Server Action. */
export function checkLogoFile(file: File): LogoCheck {
  if (file.size === 0) return { ok: false, message: 'That file is empty.' };
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, message: 'The logo must be 2 MB or smaller.' };
  }
  const extension = EXTENSION_BY_MIME[file.type];
  if (!extension) {
    return { ok: false, message: 'The logo must be a PNG, JPEG, WebP or SVG file.' };
  }
  return { ok: true, extension };
}

'use server';

import { refresh } from 'next/cache';

import { failure, invalid, success, type ActionState } from '@/lib/action-state';
import { checkPermission } from '@/lib/auth/session';
import { checkLogoFile, hospitalSettingsSchema } from '@/lib/schemas/hospital';
import { describeDatabaseError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'branding';
const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`;

/**
 * The object key inside the bucket, recovered from a stored public URL.
 * Returns null for anything that is not one of our own URLs, so a logo_url
 * that was set by hand can never be turned into a delete of someone else's
 * object.
 */
function objectPath(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  const index = logoUrl.indexOf(PUBLIC_PREFIX);
  if (index === -1) return null;
  const path = decodeURIComponent(logoUrl.slice(index + PUBLIC_PREFIX.length));
  return path === '' ? null : path;
}

export async function saveHospitalSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Server Actions answer POSTs directly, so neither the layout nor the proxy
  // is in the way here. This is the real boundary (CLAUDE.md 3.6).
  const gate = await checkPermission('settings.manage');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const parsed = hospitalSettingsSchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address'),
    phone: formData.get('phone'),
    gstin: formData.get('gstin'),
    receipt_default: formData.get('receipt_default'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const previousPath = objectPath(session.hospital.logo_url);
  let logoUrl = session.hospital.logo_url;
  let uploadedPath: string | null = null;

  const file = formData.get('logo');
  if (file instanceof File && file.size > 0) {
    const check = checkLogoFile(file);
    if (!check.ok) return failure(check.message, { logo: [check.message] });

    // One folder per tenant: the storage policies key off this first segment.
    // The timestamp makes each upload a new object, so CDN caches and printed
    // pages never serve a stale logo from the old URL.
    const path = `${session.hospitalId}/logo-${Date.now()}.${check.extension}`;

    const upload = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

    if (upload.error) {
      return failure(`The logo could not be uploaded: ${upload.error.message}`, {
        logo: ['Upload failed.'],
      });
    }

    uploadedPath = path;
    logoUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const { error } = await supabase
    .from('hospitals')
    .update({
      name: parsed.data.name,
      address: parsed.data.address,
      phone: parsed.data.phone,
      gstin: parsed.data.gstin,
      logo_url: logoUrl,
      // Merged, never replaced: settings is a shared jsonb bag and this form
      // owns exactly one key in it.
      settings: {
        ...(session.hospital.settings as Record<string, unknown> | null ?? {}),
        receipt_default: parsed.data.receipt_default,
      },
    })
    .eq('id', session.hospitalId);

  if (error) {
    // Do not leave the new file behind if the row it belongs to never changed.
    if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath]);
    return failure(describeDatabaseError(error));
  }

  // Best effort, and deliberately after the update: an orphaned file costs a
  // few kilobytes, deleting the live logo costs every printed invoice.
  if (uploadedPath && previousPath && previousPath !== uploadedPath) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  refresh();
  return success('Hospital settings saved.');
}

export async function removeHospitalLogo(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const gate = await checkPermission('settings.manage');
  if (!gate.ok) return failure(gate.message);
  const session = gate.session;

  const supabase = await createClient();
  const path = objectPath(session.hospital.logo_url);

  const { error } = await supabase
    .from('hospitals')
    .update({ logo_url: null })
    .eq('id', session.hospitalId);

  if (error) return failure(describeDatabaseError(error));

  if (path) await supabase.storage.from(BUCKET).remove([path]);

  refresh();
  return success('Logo removed. Printed documents will show the hospital name only.');
}

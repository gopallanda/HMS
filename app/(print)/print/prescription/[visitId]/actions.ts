'use server';

import { reportActionError } from '@/lib/report-error';
import { checkPermission } from '@/lib/auth/session';
import { isPrintFormat } from '@/lib/billing';
import { createClient } from '@/lib/supabase/server';

/**
 * Records that a prescription went to paper (item 7).
 *
 * Every trip to the printer stays audited (CLAUDE.md 7), and a prescription is
 * a document a patient carries out of the building: a reprint that leaves no
 * trace cannot be investigated when two copies of one script turn up at two
 * pharmacies.
 *
 * Called from the browser rather than from the render, exactly as the receipt
 * audit is: a Server Component runs again on every navigation and prefetch, so
 * auditing there would record prints nobody made and miss the second press of
 * the Print button -- which is the one that matters.
 *
 * consultation.read, not prescription.create. Reception prints the script the
 * doctor already wrote; requiring the WRITE permission to reprint it would
 * mean the only person who can hand a patient another copy is the doctor.
 */
export async function recordPrescriptionPrint(visitId: string, format: string): Promise<void> {
  const gate = await checkPermission('consultation.read');
  if (!gate.ok) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc('log_document_print', {
    p_visit_id: visitId,
    p_kind: 'prescription',
    p_format: isPrintFormat(format) ? format : 'unknown',
  });

  if (error) {
    // Logged and swallowed on purpose: a patient is waiting for the paper and
    // the paper matters more than the log line.
    reportActionError('recordPrescriptionPrint', error, {
      hospitalId: gate.session.hospitalId,
      userId: gate.session.userId,
      extra: { visit_id: visitId, format },
    });
  }
}

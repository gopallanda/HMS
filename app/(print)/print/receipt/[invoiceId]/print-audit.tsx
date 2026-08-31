'use client';

import { useEffect, useRef } from 'react';

import { recordReceiptPrint } from './actions';

/**
 * Reports each trip to the printer (block 5).
 *
 * Bound to `afterprint` rather than to the button, so it catches every route
 * to paper: the automatic dialog on arrival, the Print button, and Ctrl+P --
 * which is the one somebody uses when they do not want to be seen pressing the
 * button. A duplicate receipt at the counter is how one payment ends up with
 * two pieces of paper, and an audit trail that only covers the tidy path
 * covers nothing.
 *
 * `afterprint` fires whether the dialog was confirmed or cancelled. That is
 * accepted: the alternative is missing real prints, and "opened the print
 * dialog for invoice X" is the honest description of what is recorded.
 *
 * Errors are swallowed on purpose. A patient is standing at the counter and
 * the receipt matters more than the log line; the Server Action reports the
 * failure to the server console.
 */
export function PrintAudit({ invoiceId, format }: { invoiceId: string; format: string }) {
  // Rendered inside a Server Component that re-renders on navigation, and the
  // dialog can be opened repeatedly. One row per print, not per re-render.
  const recording = useRef(false);

  useEffect(() => {
    function onAfterPrint() {
      if (recording.current) return;
      recording.current = true;
      void recordReceiptPrint(invoiceId, format).finally(() => {
        recording.current = false;
      });
    }

    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [invoiceId, format]);

  return null;
}

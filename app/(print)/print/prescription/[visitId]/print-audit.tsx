'use client';

import { useEffect, useRef } from 'react';

import { recordPrescriptionPrint } from './actions';

/**
 * Reports each trip to the printer, the same way the receipt does.
 *
 * Bound to `afterprint` rather than to the button, so it catches every route
 * to paper: the automatic dialog on arrival, the Print button, and Ctrl+P.
 * A prescription reprinted twice is two scripts for one consultation, and an
 * audit trail that only covers the tidy path covers nothing (CLAUDE.md 7).
 *
 * Errors are swallowed on purpose. The patient is waiting for the paper.
 */
export function PrintAudit({ visitId, format }: { visitId: string; format: string }) {
  const recording = useRef(false);

  useEffect(() => {
    function onAfterPrint() {
      if (recording.current) return;
      recording.current = true;
      void recordPrescriptionPrint(visitId, format).finally(() => {
        recording.current = false;
      });
    }

    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [visitId, format]);

  return null;
}

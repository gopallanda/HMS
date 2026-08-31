'use client';

import { PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { PRINT_FORMATS, PRINT_FORMAT_LABEL, type PrintFormat } from '@/lib/billing';

/**
 * The paper.
 *
 * HTML plus `@media print`, never a headless Chromium (CLAUDE.md 7): a PDF
 * renderer is a 300MB dependency, a cold start and a bill that a serverless
 * function can fail to produce while a patient is standing at the counter. The
 * browser already has a print engine and it is attached to the printer.
 *
 * Two paper sizes from one document (CLAUDE.md 7):
 *
 *   thermal  80mm roll, no margins, continuous length. The default for OPD
 *            receipts, because that is the printer bolted to the counter.
 *   a4       for anything that leaves the building -- insurance, a company
 *            account, reimbursement.
 *
 * The CSS below is deliberately plain, not Tailwind: `@page` has no utility
 * class, and a receipt must print black-on-white whatever theme the operator
 * happens to be using at 11pm.
 */

const THERMAL_CSS = `
@page { size: 80mm auto; margin: 0; }
@media print {
  html, body { width: 80mm; background: #fff; }
}
.print-sheet {
  width: 80mm;
  padding: 3mm 4mm 6mm;
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 10px;
  line-height: 1.35;
}
`;

/**
 * A5, the second receipt stylesheet (block 5).
 *
 * The same 80mm document laid out on half a sheet, for a hospital whose
 * counter has a laser printer rather than a roll. Deliberately NOT a shrunken
 * A4 invoice: what the patient is handed at the desk is a receipt either way,
 * and only the paper changes.
 */
const A5_CSS = `
@page { size: A5; margin: 8mm; }
@media print {
  html, body { background: #fff; }
  .print-sheet { width: auto; padding: 0; box-shadow: none; }
}
.print-sheet {
  width: 148mm;
  padding: 8mm;
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.45;
}
`;

const A4_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff; }
  .print-sheet { width: auto; padding: 0; box-shadow: none; }
}
.print-sheet {
  width: 210mm;
  padding: 12mm;
  font-size: 12px;
  line-height: 1.5;
}
`;

const SHARED_CSS = `
.print-sheet { color: #000; background: #fff; }
.print-sheet table { width: 100%; border-collapse: collapse; }
.print-sheet .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.print-sheet .rule { border-top: 1px dashed #000; margin: 2mm 0; }
.print-sheet .solid { border-top: 1px solid #000; margin: 2mm 0; }
@media print {
  .print-hide { display: none !important; }
  .print-sheet { margin: 0; }
}
`;

const PAPER_HINT: Record<PrintFormat, string> = {
  thermal:
    'Set the printer to 80mm roll with no scaling. Turn off headers and footers in the browser print dialog.',
  a5: 'A5 with 8mm margins, no scaling. Turn off headers and footers in the browser print dialog.',
  a4: 'A4 with 12mm margins. Turn off headers and footers in the browser print dialog.',
};

const PAPER_CSS: Record<PrintFormat, string> = {
  thermal: THERMAL_CSS,
  a5: A5_CSS,
  a4: A4_CSS,
};

export function PrintLayout({
  format,
  autoPrint,
  backHref,
  documentHref,
  title,
  children,
}: {
  format: PrintFormat;
  /** Opens the browser print dialog on arrival. Set by the collect screen. */
  autoPrint: boolean;
  backHref: string;
  /**
   * Path to this document WITHOUT a query, e.g. `/print/receipt/<id>`. The
   * paper buttons append `?format=`.
   *
   * A string rather than the `(format) => string` builder this used to take:
   * the page that renders this is a Server Component, and a function is not
   * serialisable across that boundary -- passing one makes the whole print
   * route fail to render, which is the one screen with a patient waiting at
   * the counter for it.
   */
  documentHref: string;
  title: string;
  children: React.ReactNode;
}) {
  const printed = useRef(false);

  useEffect(() => {
    if (!autoPrint || printed.current) return;
    printed.current = true;

    // One frame, so the sheet is laid out before the dialog snapshots it.
    // Fonts are already loaded from the app shell.
    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [autoPrint]);

  return (
    <div className="flex min-h-svh flex-col items-center gap-4 bg-muted/40 py-4 print:bg-white print:py-0">
      <style>{SHARED_CSS + PAPER_CSS[format]}</style>

      {/* The paper itself is untouched by this redesign -- @media print and the
          80mm/A4 sheets are load-bearing. Only the chrome around it moved. */}
      <div className="print-hide flex w-full max-w-[210mm] flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>Back</Link>
        </Button>
        <span className="text-sm font-medium">{title}</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Paper size as a segmented control: it is one choice out of two,
              not two competing actions. */}
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {PRINT_FORMATS.map((option) => (
              <Link
                key={option}
                href={`${documentHref}?format=${option}`}
                replace
                aria-current={option === format ? 'true' : undefined}
                className={
                  option === format
                    ? 'rounded-md bg-background px-3 py-1.5 text-[0.8rem] font-medium shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-[0.8rem] text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {PRINT_FORMAT_LABEL[option]}
              </Link>
            ))}
          </div>
          <Button size="sm" onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" />
            Print
          </Button>
        </div>
      </div>

      <div className="print-sheet rounded-sm shadow-md print:rounded-none print:shadow-none">
        {children}
      </div>

      <p className="print-hide max-w-[210mm] px-3 text-center text-xs text-muted-foreground">
        {PAPER_HINT[format]}
      </p>
    </div>
  );
}

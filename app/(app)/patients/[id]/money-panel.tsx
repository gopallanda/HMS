import { PrinterIcon, ReceiptIcon } from 'lucide-react';
import Link from 'next/link';

import { SectionCard, SectionError } from './section';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_VARIANT, type InvoiceStatus } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/utils/dates';
import { formatAmount, sumMoney } from '@/lib/utils/money';

export type PatientInvoice = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  status: InvoiceStatus;
  grand_total: number;
  paid_total: number;
  balance: number;
  visit_no: string | null;
  token_no: number | null;
};

/**
 * What this patient has been billed, and what is still owed.
 *
 * "What does he still owe" is the question asked at the counter, out loud,
 * while the patient stands there -- so it is a figure on the record rather than
 * something to be worked out by opening five invoices.
 *
 * Voided invoices are listed but excluded from all three totals. The number
 * stays consumed and the row stays history (CLAUDE.md 3.2); what it is not is
 * money. invoice_summary already reads a voided bill as zero collected, and
 * dropping its grand_total from `billed` is the other half of the same rule.
 */
export function MoneyPanel({
  invoices,
  error,
}: {
  /** null when the read failed -- not the same as "never been billed". */
  invoices: PatientInvoice[] | null;
  error?: string;
}) {
  if (invoices === null) {
    return (
      <SectionCard id="money" title="Billing">
        <SectionError>
          The invoices could not be read, so no balance is shown rather than a wrong one. Do not
          treat this as nothing owed. {error}
        </SectionError>
      </SectionCard>
    );
  }

  const live = invoices.filter((invoice) => invoice.status !== 'void');
  const billed = sumMoney(live.map((invoice) => invoice.grand_total));
  const collected = sumMoney(live.map((invoice) => invoice.paid_total));
  const outstanding = sumMoney(live.map((invoice) => invoice.balance));

  return (
    <SectionCard id="money" title="Billing" count={invoices.length}>
      <div className="grid gap-3">
        <dl className="grid grid-cols-3 gap-2">
          <Total label="Billed" value={billed} />
          <Total label="Collected" value={collected} />
          <Total
            label="Outstanding"
            value={outstanding}
            // The only figure on this page that is allowed to be loud, and only
            // when it is not zero: it is the one number somebody has to act on
            // before the patient walks out.
            tone={outstanding > 0 ? 'due' : 'settled'}
          />
        </dl>

        {invoices.length === 0 ? (
          <EmptyState
            compact
            icon={ReceiptIcon}
            title="Nothing billed yet"
            description="Charges raised on a visit appear here once they have been collected."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Invoice</TableHead>
                <TableHead className="hidden w-32 sm:table-cell">Date</TableHead>
                <TableHead className="hidden lg:table-cell">Visit</TableHead>
                <TableHead className="w-24 text-right">Total &#8377;</TableHead>
                <TableHead className="hidden w-24 text-right sm:table-cell">Paid &#8377;</TableHead>
                <TableHead className="w-24 text-right">Balance &#8377;</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id} className={cn(invoice.status === 'void' && 'opacity-60')}>
                  <TableCell
                    className={cn('font-mono text-xs', invoice.status === 'void' && 'line-through')}
                  >
                    {invoice.invoice_no}
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {formatDate(invoice.invoice_date)}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                    {invoice.visit_no ?? '-'}
                    {invoice.token_no !== null ? ` · ${invoice.token_no}` : ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(invoice.grand_total)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatAmount(invoice.paid_total)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium tabular-nums',
                      invoice.status !== 'void' && invoice.balance > 0 && 'text-destructive',
                    )}
                  >
                    {invoice.status === 'void' ? '-' : formatAmount(invoice.balance)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/print/receipt/${invoice.id}?autoprint=0`}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Print ${invoice.invoice_no}`}
                      title={`Print ${invoice.invoice_no}`}
                    >
                      <PrinterIcon className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SectionCard>
  );
}

function Total({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'due' | 'settled';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 px-3 py-2',
        tone === 'due' && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-xl leading-none font-bold tracking-tight tabular-nums',
          tone === 'due' && 'text-destructive',
          tone === 'settled' && 'text-success',
        )}
      >
        &#8377;{formatAmount(value)}
      </dd>
    </div>
  );
}

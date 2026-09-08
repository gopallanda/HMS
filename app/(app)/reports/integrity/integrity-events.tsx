import { PrinterIcon } from 'lucide-react';
import Link from 'next/link';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  INTEGRITY_AMOUNT_LABEL,
  INTEGRITY_LABEL,
  type IntegrityEvent,
  type IntegrityKind,
} from '@/lib/rpc/integrity';
import { formatDateTime } from '@/lib/utils/dates';
import { formatAmount } from '@/lib/utils/money';

/**
 * How loud each kind is.
 *
 * A reprint is usually a jammed roll and a deferral is usually a decision
 * somebody made on purpose, so neither shouts. A void and a reversal both
 * undo money that was already recorded, which is the pair an auditor reads
 * first.
 */
const KIND_TONE: Record<IntegrityKind, BadgeVariant> = {
  void: 'destructive',
  reversal: 'destructive',
  discount: 'warning',
  deferral: 'info',
  reprint: 'secondary',
};

/**
 * What happened, in order, with the reason typed at the time.
 *
 * The reason column is the point of the screen. Every one of these actions
 * already required a typed reason (CLAUDE.md 7) and until now nothing ever
 * read one back; a list of counts without them would tell an owner that six
 * bills were voided and nothing about whether that was six roll jams or six
 * arguments.
 *
 * Cards on a phone, a table on a laptop -- the same shape the dues and invoice
 * lists use, because this is read at the same desk.
 *
 * The print link carries `?autoprint=0` deliberately: opening a receipt from
 * the report that COUNTS reprints must not itself produce one. The audit hook
 * is bound to `afterprint`, so nothing is logged unless somebody genuinely
 * sends it to the printer.
 */
export function IntegrityEvents({ events }: { events: IntegrityEvent[] }) {
  return (
    <>
      <div className="grid gap-2 lg:hidden">
        {events.map((event) => (
          <div
            key={event.id}
            className={cn(
              'rounded-xl border border-border/60 bg-card p-3 shadow-sm',
              event.afterClose && 'border-l-4 border-l-destructive',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={KIND_TONE[event.kind]}>
                    {INTEGRITY_LABEL[event.kind]}
                  </Badge>
                  {event.afterClose ? (
                    <Badge variant="destructive">After close</Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium">{event.actorName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDateTime(event.at)}
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block font-bold tabular-nums">
                  &#8377;{formatAmount(event.amount)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {INTEGRITY_AMOUNT_LABEL[event.kind]}
                </span>
              </span>
            </div>

            <p className="mt-2.5 border-t border-border/60 pt-2.5 text-sm">
              {event.reason ?? (
                <span className="text-muted-foreground italic">No reason recorded</span>
              )}
            </p>
            {event.detail ? (
              <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p>
            ) : null}

            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {event.invoiceNo}
              {event.patientName ? ` · ${event.patientName}` : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead className="w-32">What</TableHead>
              <TableHead className="w-44">Who</TableHead>
              <TableHead className="w-40">Invoice</TableHead>
              <TableHead className="w-28 text-right">Amount &#8377;</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-16 text-right">Bill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow
                key={event.id}
                className={cn(
                  'even:bg-muted/25',
                  event.afterClose && 'border-l-4 border-l-destructive',
                )}
              >
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(event.at)}
                </TableCell>
                <TableCell>
                  <Badge variant={KIND_TONE[event.kind]}>
                    {INTEGRITY_LABEL[event.kind]}
                  </Badge>
                  {event.afterClose ? (
                    <span className="mt-1 block text-xs font-medium text-destructive">
                      After close
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="truncate text-sm">{event.actorName}</TableCell>
                <TableCell>
                  <span className="block truncate font-mono text-xs">
                    {event.invoiceNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {event.patientName}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="block font-medium tabular-nums">
                    {formatAmount(event.amount)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {INTEGRITY_AMOUNT_LABEL[event.kind]}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {event.reason ?? (
                    <span className="text-muted-foreground italic">No reason recorded</span>
                  )}
                  {event.detail ? (
                    <span className="block text-xs text-muted-foreground">
                      {event.detail}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {event.invoiceId ? (
                    <Button asChild variant="ghost" size="icon-sm" title="Open the bill">
                      <Link href={`/print/receipt/${event.invoiceId}?autoprint=0`}>
                        <PrinterIcon />
                        <span className="sr-only">Open {event.invoiceNo}</span>
                      </Link>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

'use client';

import { LockKeyholeOpenIcon } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { closeDayAction } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { MoneyInput } from '@/components/shared/money-input';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/utils/dates';
import { formatAmount, formatMoney } from '@/lib/utils/money';

export type DayClosure = {
  declared_cash: number;
  system_cash: number;
  variance: number;
  notes: string | null;
  closed_at: string;
  closed_by_name: string | null;
};

/**
 * Counting the drawer.
 *
 * The variance is the entire reason an owner opens this screen, and until now
 * the page could not produce one: it reported what the system took and had
 * nowhere to put what was actually in the box.
 *
 * Only the CASH line is reconciled. Card and UPI settle into a bank account
 * and are nobody's counting problem at the counter.
 *
 * Closing locks nothing (CLAUDE.md, and the day-close note): a hospital where
 * a nine o'clock correction is impossible is a hospital that stops closing
 * days. Re-closing overwrites the row and the audit trail keeps both counts.
 */
export function ClosePanel({
  date,
  systemCash,
  closure,
  canClose,
}: {
  date: string;
  /** What day_close_report says came in as cash on this day. */
  systemCash: number;
  /** The existing closure for this day, if it has been counted before. */
  closure: DayClosure | null;
  /** reports.view. The action re-checks; this only decides what is drawn. */
  canClose: boolean;
}) {
  const [state, action] = useActionState(closeDayAction, IDLE);
  const [declared, setDeclared] = useState(() =>
    closure ? formatAmount(closure.declared_cash) : '',
  );
  const [notes, setNotes] = useState(() => closure?.notes ?? '');

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
  }, [state]);

  const typed = Number.parseFloat(declared.replace(/[^0-9.]/g, ''));
  const previewVariance = Number.isFinite(typed)
    ? Math.round((typed - systemCash) * 100) / 100
    : null;

  return (
    <section className="grid gap-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Count the drawer</h2>
        {closure ? (
          <p className="text-xs text-muted-foreground">
            Closed {formatDateTime(closure.closed_at)}
            {closure.closed_by_name ? ` by ${closure.closed_by_name}` : ''}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Not counted yet</p>
        )}
      </div>

      {closure ? (
        <dl className="grid gap-2 sm:grid-cols-3">
          <Figure label="System cash" value={closure.system_cash} />
          <Figure label="Counted" value={closure.declared_cash} />
          <Figure
            label="Variance"
            value={closure.variance}
            tone={Math.abs(closure.variance) < 0.005 ? 'settled' : 'due'}
            signed
          />
        </dl>
      ) : null}

      {closure?.notes ? (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{closure.notes}</p>
      ) : null}

      {canClose ? (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="date" value={date} />

          <FormMessage state={state} />

          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start">
            <Field
              label="Cash counted"
              htmlFor="declared-cash"
              error={fieldError(state, 'declared_cash')}
              hint={`System says ${formatAmount(systemCash)}`}
              required
            >
              <MoneyInput
                id="declared-cash"
                name="declared_cash"
                value={declared}
                onChange={(event) => setDeclared(event.target.value)}
                placeholder="0.00"
                className="h-11 text-lg font-bold md:h-11 md:text-lg"
                aria-invalid={fieldError(state, 'declared_cash') !== undefined}
              />
            </Field>

            <Field
              label="Notes"
              htmlFor="close-notes"
              error={fieldError(state, 'notes')}
              hint={
                previewVariance !== null && Math.abs(previewVariance) >= 0.005
                  ? `That is ${formatMoney(Math.abs(previewVariance))} ${previewVariance > 0 ? 'over' : 'short'}. Say why.`
                  : 'Optional. Where a variance gets explained.'
              }
            >
              <Input
                id="close-notes"
                name="notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={500}
                autoComplete="off"
                placeholder="500 short - Ramesh took an advance against salary"
                className="h-11 md:h-11"
              />
            </Field>

            <div className="sm:pt-6.5">
              <SubmitButton className="h-11 w-full sm:w-auto" pendingLabel="Closing...">
                {closure ? 'Re-close day' : 'Close day'}
              </SubmitButton>
            </div>
          </div>
        </form>
      ) : null}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockKeyholeOpenIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Closing records the count. It locks nothing &mdash; a payment taken after this still
          lands on the day, and counting again overwrites the figures with both counts kept in
          the audit log. Card and UPI settle into the bank and are not part of the drawer.
        </span>
      </p>
    </section>
  );
}

function Figure({
  label,
  value,
  tone = 'plain',
  signed = false,
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'due' | 'settled';
  signed?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 px-3 py-2',
        tone === 'due' && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 text-xl leading-none font-bold tracking-tight tabular-nums',
          tone === 'due' && 'text-destructive',
          tone === 'settled' && 'text-success',
        )}
      >
        {signed && value > 0 ? '+' : signed && value < 0 ? '-' : ''}
        &#8377;{formatAmount(Math.abs(value))}
      </dd>
    </div>
  );
}

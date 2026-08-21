'use client';

import { useQuery } from '@tanstack/react-query';
import { PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { collectPaymentAction, type CollectPaymentState } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { MoneyInput } from '@/components/shared/money-input';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fieldError, IDLE } from '@/lib/action-state';
import {
  PAYMENT_MODES,
  PAYMENT_MODE_LABEL,
  expectsReference,
  totalsFor,
  type ChargeLine,
  type PaymentMode,
} from '@/lib/billing';
import { cn } from '@/lib/cn';
import { ageGender, type Gender } from '@/lib/patients';
import type { BillLine } from '@/lib/schemas/billing';
import { createClient } from '@/lib/supabase/client';
import { formatDate, formatTime } from '@/lib/utils/dates';
import { formatAmount, formatMoney, lineAmount, parseMoney } from '@/lib/utils/money';
import { VISIT_TYPE_LABEL, type VisitStatus, type VisitType } from '@/lib/visits';
import type { Database } from '@/types/database';

export type BillingVisit = {
  visit_id: string;
  visit_no: string;
  token_no: number;
  visit_type: VisitType;
  visit_status: VisitStatus;
  visited_at: string;
  patient_id: string;
  patient_mrn: string;
  patient_name: string;
  patient_dob: string;
  patient_gender: Gender;
  patient_phone: string | null;
  doctor_name: string | null;
  department_name: string | null;
  pending_count: number;
  pending_total: number;
  invoiced_total: number;
  invoice_count: number;
};

export type ServiceOption = {
  id: string;
  name: string;
  category: Database['public']['Enums']['service_category'];
  price: number;
  tax_rate: number;
};

/** A charge typed at the counter, before it is a row anywhere. */
type AdHocLine = {
  /** Local only. The database id is minted by collect_payment. */
  key: string;
  service_id: string;
  description: string;
  qty: string;
  unit_price: string;
  tax_rate: number;
};

const CATEGORY_LABEL: Record<ServiceOption['category'], string> = {
  consultation: 'Consultation',
  lab: 'Laboratory',
  procedure: 'Procedures',
  bed: 'Beds',
  pharmacy: 'Pharmacy',
  other: 'Other',
};

export function CollectDesk({
  visits,
  services,
  hospitalId,
  selectedVisitId,
}: {
  visits: BillingVisit[];
  services: ServiceOption[];
  hospitalId: string;
  selectedVisitId: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(selectedVisitId);
  const [highlight, setHighlight] = useState(0);

  const searchInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const serviceTrigger = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * The bill in progress. Reset whenever the visit changes -- carrying an
   * ad-hoc line from one patient to the next is the worst bug this screen
   * could have.
   */
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [adHoc, setAdHoc] = useState<AdHocLine[]>([]);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [amountDraft, setAmountDraft] = useState('');
  const [amountEdited, setAmountEdited] = useState(false);
  /** Bumped to remount the service picker after each pick. */
  const [picker, setPicker] = useState(0);

  /**
   * One id per bill, minted in the browser (CLAUDE.md 7). A double-click or a
   * resubmit after a dropped connection returns the invoice that was already
   * written instead of billing the patient twice. A new one is minted after a
   * successful collection, below.
   */
  const [invoiceId, setInvoiceId] = useState(() => crypto.randomUUID());

  const initial: CollectPaymentState = IDLE;
  const [state, action] = useActionState(collectPaymentAction, initial);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return visits;
    return visits.filter((visit) =>
      [
        visit.patient_name,
        visit.patient_mrn,
        visit.visit_no,
        visit.patient_phone ?? '',
        String(visit.token_no),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [visits, query]);

  const selected = useMemo(
    () => visits.find((visit) => visit.visit_id === selectedId) ?? null,
    [visits, selectedId],
  );

  /**
   * What is already pending on this visit -- the consultation fee create_visit
   * raised, anything the doctor or the lab added since. Read live rather than
   * on the server with the list, because a charge can appear while the counter
   * is looking at the patient.
   */
  const charges = useQuery({
    queryKey: ['pending-charges', selectedId],
    enabled: selectedId !== null,
    queryFn: async () => {
      if (selectedId === null) return [];
      const { data, error } = await supabase
        .from('charge_items')
        .select('id, description, qty, unit_price, amount, tax_rate, source_module, created_at')
        .eq('hospital_id', hospitalId)
        .eq('visit_id', selectedId)
        .eq('status', 'pending')
        .order('created_at');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const pending = useMemo(() => charges.data ?? [], [charges.data]);

  /**
   * Everything on the bill, in one shape, in the order it will print.
   * `service_id` is what tells the two kinds apart on the way out: a line that
   * has one is a charge to raise, a line without one already exists.
   */
  const lines: (ChargeLine & { key: string; service_id: string | null })[] = useMemo(() => {
    const fromVisit = pending
      .filter((charge) => !dropped.has(charge.id))
      .map((charge) => ({
        key: charge.id,
        id: charge.id,
        description: charge.description,
        qty: charge.qty,
        unit_price: charge.unit_price,
        amount: charge.amount,
        tax_rate: charge.tax_rate,
        service_id: null,
      }));

    const typed = adHoc.map((line) => {
      const qty = parseMoney(line.qty) ?? 0;
      const price = parseMoney(line.unit_price) ?? 0;
      return {
        key: line.key,
        id: line.key,
        description: line.description,
        qty,
        unit_price: price,
        amount: lineAmount(qty, price),
        tax_rate: line.tax_rate,
        service_id: line.service_id,
      };
    });

    return [...fromVisit, ...typed];
  }, [pending, dropped, adHoc]);

  // A preview only. The invoice is whatever collect_payment computes inside
  // the transaction -- this is here so the patient can be told a number before
  // the button is pressed.
  const totals = useMemo(() => totalsFor(lines), [lines]);

  const payload: BillLine[] = useMemo(
    () =>
      lines.map((line) =>
        line.service_id === null
          ? { kind: 'existing', charge_item_id: line.id }
          : {
              kind: 'service',
              service_id: line.service_id,
              description: line.description,
              qty: line.qty,
              unit_price: line.unit_price,
            },
      ),
    [lines],
  );

  /**
   * The amount follows the bill until somebody types over it. Part payment is
   * a real thing at a counter, but the overwhelmingly common case is "pay the
   * whole bill", and that should need no typing at all.
   *
   * Derived during render rather than synced in an effect: an effect would
   * render the old total once before correcting itself, and the value it is
   * correcting is the one on the button the cashier is about to press.
   */
  const amount = amountEdited ? amountDraft : totals.grandTotal.toFixed(2);

  const selectVisit = useCallback((visitId: string | null) => {
    setSelectedId(visitId);
    setDropped(new Set());
    setAdHoc([]);
    setReference('');
    setAmountDraft('');
    setAmountEdited(false);
    setInvoiceId(crypto.randomUUID());
  }, []);

  // Keep the highlighted row visible when the list is longer than the panel.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  useEffect(() => {
    if (state.status === 'success' && state.invoice) {
      toast.success(`${state.invoice.invoice_no} - ${formatMoney(state.invoice.grand_total)}`, {
        description: 'Opening the receipt.',
      });
      // The receipt is the last step of the job, not an optional extra: the
      // patient is still standing there. autoprint opens the browser's print
      // dialog on arrival.
      router.push(`/print/invoice/${state.invoice.id}?autoprint=1`);
    }
  }, [state, router]);

  /** Global keys. Nothing fires while the caret is inside a field. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [role="dialog"]') !== null;

      // Alt is not a typing modifier, so the mode keys work from inside the
      // amount box -- which is exactly where the operator's hands are.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < PAYMENT_MODES.length) {
          event.preventDefault();
          setMode(PAYMENT_MODES[index]);
          return;
        }
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault();
          amountInput.current?.focus();
          amountInput.current?.select();
          return;
        }
        if (event.key.toLowerCase() === 's') {
          event.preventDefault();
          serviceTrigger.current?.click();
          return;
        }
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) =>
        filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = filtered[Math.min(highlight, filtered.length - 1)];
      if (picked) selectVisit(picked.visit_id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query !== '') setQuery('');
      else selectVisit(null);
    }
  }

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function addService(serviceId: string) {
    const service = services.find((option) => option.id === serviceId);
    if (!service) return;

    setPicker((current) => current + 1);
    setAdHoc((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        service_id: service.id,
        description: service.name,
        qty: '1',
        // Pre-filled from the charge master and editable from here on
        // (CLAUDE.md: amount pre-fills, stays editable). The TAX rate is not
        // editable and is not even sent -- collect_payment reads it from the
        // service, so a discount at the counter cannot quietly change the GST
        // on a pharmacy line.
        unit_price: service.price.toFixed(2),
        tax_rate: service.tax_rate,
      },
    ]);
  }

  const canSubmit = lines.length > 0 && selected !== null;
  const amountValue = parseMoney(amount) ?? 0;
  const balance = totals.grandTotal - amountValue;

  return (
    <div className="grid gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ------------------------------------------------------------------ */}
      {/* Who is at the counter                                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="grid content-start gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-3.5 text-muted-foreground" />
          <Input
            ref={searchInput}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Token, name, MRN or phone"
            className="h-8 pl-8"
            aria-label="Find a visit to bill"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Today's visits"
          className="max-h-[32rem] overflow-y-auto rounded-lg border"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              {visits.length === 0
                ? 'Nobody has been registered today yet.'
                : `Nothing matches "${query.trim()}".`}
            </p>
          ) : (
            filtered.map((visit, index) => (
              <button
                key={visit.visit_id}
                type="button"
                data-index={index}
                role="option"
                aria-selected={visit.visit_id === selectedId}
                onMouseMove={() => setHighlight(index)}
                onClick={() => selectVisit(visit.visit_id)}
                className={cn(
                  'flex w-full items-center gap-2 border-b px-2.5 py-2 text-left text-sm last:border-0',
                  index === highlight && 'bg-muted/60',
                  visit.visit_id === selectedId && 'bg-muted',
                )}
              >
                <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {visit.token_no}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{visit.patient_name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {visit.patient_mrn}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums">
                  {visit.pending_count > 0 ? (
                    <span className="font-medium">{formatAmount(visit.pending_total)}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {visit.invoice_count > 0 ? 'billed' : '-'}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          <kbd className="rounded border px-1">/</kbd> find
          <span className="mx-1">&middot;</span>
          <kbd className="rounded border px-1">&uarr;</kbd>
          <kbd className="ml-0.5 rounded border px-1">&darr;</kbd> move
          <span className="mx-1">&middot;</span>
          <kbd className="rounded border px-1">Enter</kbd> open bill
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The bill                                                           */}
      {/* ------------------------------------------------------------------ */}
      {selected === null ? (
        <section className="grid place-content-center rounded-lg border px-6 py-16 text-center">
          <p className="text-sm font-medium">Pick a visit to bill</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Type to find the patient, or press <kbd className="rounded border px-1">/</kbd> and
            use the arrow keys. The pending charges on the visit load with it.
          </p>
        </section>
      ) : (
        <form
          ref={formRef}
          action={action}
          onKeyDown={onFormKeyDown}
          className="grid content-start gap-3 rounded-lg border p-3"
        >
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <input type="hidden" name="visit_id" value={selected.visit_id} />
          <input type="hidden" name="items" value={JSON.stringify(payload)} />
          <input type="hidden" name="mode" value={mode} />

          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2">
            <span className="text-sm font-semibold">{selected.patient_name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {selected.patient_mrn}
            </span>
            <span className="text-xs text-muted-foreground">
              {ageGender(selected.patient_dob, selected.patient_gender)}
            </span>
            <Badge variant="secondary">Token {selected.token_no}</Badge>
            {selected.visit_type !== 'opd' ? (
              <Badge variant="destructive">{VISIT_TYPE_LABEL[selected.visit_type]}</Badge>
            ) : null}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {selected.visit_no} &middot; {formatDate(selected.visited_at)}{' '}
              {formatTime(selected.visited_at)}
              {selected.doctor_name ? ` · ${selected.doctor_name}` : ''}
              {selected.department_name ? ` · ${selected.department_name}` : ''}
            </span>
          </header>

          <FormMessage state={state} />

          {state.stale ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Nothing was charged. Reload this visit to see what is actually still pending.{' '}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => {
                  void charges.refetch();
                  router.refresh();
                }}
              >
                Reload now
              </button>
            </p>
          ) : null}

          {/* -------------------------------------------------------------- */}
          {/* Lines                                                          */}
          {/* -------------------------------------------------------------- */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="w-8 py-1.5" />
                  <th className="px-2 py-1.5 text-left font-medium">Charge</th>
                  <th className="w-20 px-2 py-1.5 text-right font-medium">Qty</th>
                  <th className="w-32 px-2 py-1.5 text-right font-medium">Rate &#8377;</th>
                  <th className="w-16 px-2 py-1.5 text-right font-medium">GST %</th>
                  <th className="w-28 px-2 py-1.5 text-right font-medium">Amount &#8377;</th>
                  <th className="w-8 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {charges.isPending ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      Loading charges...
                    </td>
                  </tr>
                ) : null}

                {charges.error ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-xs text-destructive">
                      The pending charges could not be read: {charges.error.message}
                    </td>
                  </tr>
                ) : null}

                {/* Already raised on the visit. Unticking leaves the charge
                    pending for a later bill rather than cancelling it. */}
                {pending.map((charge) => {
                  const included = !dropped.has(charge.id);
                  return (
                    <tr key={charge.id} className={cn('border-b', !included && 'opacity-45')}>
                      <td className="py-1.5 text-center">
                        <Checkbox
                          checked={included}
                          aria-label={`Include ${charge.description}`}
                          onCheckedChange={(value) =>
                            setDropped((current) => {
                              const next = new Set(current);
                              if (value === true) next.delete(charge.id);
                              else next.add(charge.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block truncate">{charge.description}</span>
                        <span className="text-[11px] text-muted-foreground">
                          raised by {charge.source_module.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{charge.qty}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatAmount(charge.unit_price)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                        {charge.tax_rate > 0 ? charge.tax_rate : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatAmount(charge.amount)}
                      </td>
                      <td />
                    </tr>
                  );
                })}

                {/* Typed at the counter. */}
                {adHoc.map((line) => {
                  const qty = parseMoney(line.qty) ?? 0;
                  const price = parseMoney(line.unit_price) ?? 0;
                  return (
                    <tr key={line.key} className="border-b">
                      <td className="py-1.5 text-center">
                        <PlusIcon className="mx-auto size-3 text-muted-foreground" aria-hidden />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={line.description}
                          onChange={(event) =>
                            setAdHoc((current) =>
                              current.map((item) =>
                                item.key === line.key
                                  ? { ...item, description: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-7"
                          aria-label="Charge description"
                          maxLength={200}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={line.qty}
                          onChange={(event) =>
                            setAdHoc((current) =>
                              current.map((item) =>
                                item.key === line.key ? { ...item, qty: event.target.value } : item,
                              ),
                            )
                          }
                          inputMode="decimal"
                          className="h-7 text-right tabular-nums"
                          aria-label="Quantity"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <MoneyInput
                          value={line.unit_price}
                          onChange={(event) =>
                            setAdHoc((current) =>
                              current.map((item) =>
                                item.key === line.key
                                  ? { ...item, unit_price: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-7"
                          aria-label="Rate"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                        {line.tax_rate > 0 ? line.tax_rate : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatAmount(lineAmount(qty, price))}
                      </td>
                      <td className="py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setAdHoc((current) => current.filter((item) => item.key !== line.key))
                          }
                          aria-label={`Remove ${line.description}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!charges.isPending && lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      Nothing pending on this visit. Add a charge below to raise a bill.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Add from the charge master                                     */}
          {/* -------------------------------------------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Remounted after every pick (the key), so the trigger goes back
                to its placeholder and the same service can be added twice --
                two dressings on one bill is an ordinary thing. */}
            <Select key={picker} onValueChange={addService}>
              <SelectTrigger ref={serviceTrigger} className="h-8 w-72" aria-label="Add a charge">
                <SelectValue placeholder="Add a charge from the service list" />
              </SelectTrigger>
              <SelectContent>
                {(
                  ['consultation', 'procedure', 'lab', 'pharmacy', 'bed', 'other'] as const
                ).map((category) => {
                  const options = services.filter((service) => service.category === category);
                  if (options.length === 0) return null;
                  return (
                    <SelectGroup key={category}>
                      <SelectLabel>{CATEGORY_LABEL[category]}</SelectLabel>
                      {options.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name} - {formatAmount(service.price)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              <kbd className="rounded border px-1">Alt</kbd>+
              <kbd className="rounded border px-1">S</kbd> add &middot; the rate pre-fills and
              stays editable
            </span>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Totals and money                                               */}
          {/* -------------------------------------------------------------- */}
          <div className="grid gap-3 md:grid-cols-2">
            <dl className="grid content-start gap-1 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  GST
                  {totals.taxTotal === 0 ? (
                    <span className="ml-1 text-[11px]">(services are exempt)</span>
                  ) : null}
                </dt>
                <dd className="tabular-nums">{formatMoney(totals.taxTotal)}</dd>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(totals.grandTotal)}</dd>
              </div>
              {Math.abs(balance) >= 0.005 ? (
                <div className="flex justify-between text-xs">
                  <dt className="text-muted-foreground">
                    {balance > 0 ? 'Balance after this payment' : 'Over the bill'}
                  </dt>
                  <dd
                    className={cn(
                      'tabular-nums',
                      balance < 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {formatMoney(Math.abs(balance))}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="grid content-start gap-3">
              <Field label="Payment mode" htmlFor="payment-mode" error={fieldError(state, 'mode')}>
                <div id="payment-mode" className="flex flex-wrap gap-1">
                  {PAYMENT_MODES.map((option, index) => (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={mode === option ? 'default' : 'outline'}
                      aria-pressed={mode === option}
                      onClick={() => setMode(option)}
                    >
                      {PAYMENT_MODE_LABEL[option]}
                      <span className="ml-1.5 text-[10px] opacity-60">Alt+{index + 1}</span>
                    </Button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Amount collected"
                  htmlFor="payment-amount"
                  error={fieldError(state, 'amount')}
                  hint="Zero raises the bill unpaid."
                >
                  <MoneyInput
                    ref={amountInput}
                    id="payment-amount"
                    name="amount"
                    value={amount}
                    onChange={(event) => {
                      setAmountDraft(event.target.value);
                      setAmountEdited(true);
                    }}
                    className="h-9 text-base"
                    aria-invalid={fieldError(state, 'amount') !== undefined}
                  />
                </Field>

                <Field
                  label="Reference"
                  htmlFor="payment-reference"
                  error={fieldError(state, 'reference')}
                  hint={expectsReference(mode) ? 'UPI or approval code.' : 'Optional.'}
                >
                  <Input
                    id="payment-reference"
                    name="reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    maxLength={80}
                    autoComplete="off"
                    placeholder={expectsReference(mode) ? 'Txn id' : ''}
                  />
                </Field>
              </div>
            </div>
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t pt-2">
            <span className="text-[11px] text-muted-foreground">
              <kbd className="rounded border px-1">Alt</kbd>+
              <kbd className="rounded border px-1">A</kbd> amount
              <span className="mx-1">&middot;</span>
              <kbd className="rounded border px-1">Alt</kbd>+
              <kbd className="rounded border px-1">1-4</kbd> mode
              <span className="mx-1">&middot;</span>
              <kbd className="rounded border px-1">Ctrl</kbd>+
              <kbd className="rounded border px-1">Enter</kbd> take payment
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => selectVisit(null)}
            >
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Taking payment..." disabled={!canSubmit}>
              Paid {formatMoney(amountValue)}
            </SubmitButton>
          </footer>
        </form>
      )}
    </div>
  );
}

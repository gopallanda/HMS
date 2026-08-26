'use client';

import Link from 'next/link';
import { PencilIcon, PlusIcon, ReceiptIndianRupeeIcon } from 'lucide-react';
import { Fragment, useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { saveService, setServiceActive } from './actions';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/shared/field';
import { KbdHint } from '@/components/shared/kbd';
import { FormMessage } from '@/components/shared/form-message';
import { MoneyInput } from '@/components/shared/money-input';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldError, IDLE, type ActionState } from '@/lib/action-state';
import { cn } from '@/lib/cn';
import {
  expectsTax,
  priceIsAdvisory,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABEL,
  type ServiceCategory,
} from '@/lib/services';
import { formatAmount } from '@/lib/utils/money';

export type ServiceRow = {
  id: string;
  name: string;
  category: ServiceCategory;
  price: number;
  tax_rate: number;
  is_active: boolean;
};

/** The chip that means "no category filter". */
const ALL = '__all__';

function blankService(category: ServiceCategory | null): ServiceRow {
  // Minted here, not in Postgres: a resubmitted form then updates the row it
  // already created instead of adding a second one (CLAUDE.md 7).
  return {
    id: crypto.randomUUID(),
    name: '',
    // A new row lands in whichever category is being looked at -- filtering to
    // Lab and pressing N almost always means "another lab test".
    category: category ?? 'consultation',
    price: 0,
    tax_rate: 0,
    is_active: true,
  };
}

export function ServicesTable({ services }: { services: ServiceRow[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ServiceCategory | typeof ALL>(ALL);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [deactivating, setDeactivating] = useState<ServiceRow | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const countByCategory = useMemo(() => {
    const counts = new Map<ServiceCategory, number>();
    for (const service of services) {
      counts.set(service.category, (counts.get(service.category) ?? 0) + 1);
    }
    return counts;
  }, [services]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return services.filter((service) => {
      if (category !== ALL && service.category !== category) return false;
      if (!needle) return true;
      return (
        service.name.toLowerCase().includes(needle) ||
        SERVICE_CATEGORY_LABEL[service.category].toLowerCase().includes(needle)
      );
    });
  }, [services, query, category]);

  /**
   * Rows grouped under their category heading, in the order SERVICE_CATEGORIES
   * declares -- not alphabetically and not in enum order. An owner reads this
   * screen looking for "what do we charge for a dressing", and the category is
   * how they narrow it before they read a single price.
   */
  const groups = useMemo(
    () =>
      SERVICE_CATEGORIES.map((key) => ({
        key,
        rows: filtered.filter((service) => service.category === key),
      })).filter((group) => group.rows.length > 0),
    [filtered],
  );

  // Keyboard first (CLAUDE.md 7). Same two bindings as departments and staff:
  // `/` searches, `N` opens a new row. They mean the same thing everywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setEditing(blankService(category === ALL ? null : category));
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [category]);

  const activeCount = services.filter((service) => service.is_active).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search service"
          className="w-full sm:w-64"
          aria-label="Search services"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {services.length} &middot; {activeCount} active
        </span>
        <span className="ml-auto flex items-center gap-4">
          <KbdHint keys="/">search</KbdHint>
          <KbdHint keys="N">new</KbdHint>
        </span>
        <Button onClick={() => setEditing(blankService(category === ALL ? null : category))}>
          <PlusIcon data-icon="inline-start" />
          New service
        </Button>
      </div>

      {/* Category chips rather than a select: there are seven of them, they are
          the primary way this list is narrowed, and one click is cheaper than
          open-read-pick. Counts sit on the chip so an empty category is
          obvious before it is clicked. */}
      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
        <CategoryChip
          label="All"
          count={services.length}
          selected={category === ALL}
          onSelect={() => setCategory(ALL)}
        />
        {SERVICE_CATEGORIES.map((key) => (
          <CategoryChip
            key={key}
            label={SERVICE_CATEGORY_LABEL[key]}
            count={countByCategory.get(key) ?? 0}
            selected={category === key}
            onSelect={() => setCategory(key)}
          />
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-36 text-right">Price (&#8377;)</TableHead>
              <TableHead className="w-24 text-right">GST %</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-48 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="p-0">
                  <EmptyState
                    compact
                    icon={ReceiptIndianRupeeIcon}
                    title={
                      services.length === 0
                        ? 'No services yet'
                        : `Nothing matches “${query}”`
                    }
                    description={
                      services.length === 0
                        ? 'Nothing can be billed until this list exists. Start with the OPD consultation — it is the charge the counter raises most.'
                        : undefined
                    }
                    action={
                      services.length === 0 ? (
                        <Button onClick={() => setEditing(blankService('consultation'))}>
                          <PlusIcon data-icon="inline-start" />
                          Add a consultation charge
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <Fragment key={group.key}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={5}
                      className="bg-muted/50 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      {SERVICE_CATEGORY_LABEL[group.key]}
                      <span className="ml-2 font-normal normal-case opacity-70">
                        {group.rows.length}
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.rows.map((service) => (
                    <TableRow
                      key={service.id}
                      className={cn('even:bg-muted/25', !service.is_active && 'opacity-60')}
                    >
                      <TableCell className="font-medium">
                        {service.name}
                        {priceIsAdvisory(service.category) ? <ConsultationNote /> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAmount(service.price)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          service.tax_rate === 0 && 'text-muted-foreground',
                        )}
                      >
                        {service.tax_rate.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={service.is_active ? 'success' : 'outline'}>
                          {service.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="ghost" onClick={() => setEditing(service)}>
                            <PencilIcon data-icon="inline-start" />
                            Edit
                          </Button>
                          {service.is_active ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeactivating(service)}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <ReactivateButton service={service} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <ServiceDialog
          key={editing.id}
          service={editing}
          isNew={!services.some((row) => row.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deactivating ? (
        <DeactivateDialog
          key={deactivating.id}
          service={deactivating}
          onClose={() => setDeactivating(null)}
        />
      ) : null}
    </>
  );
}

function CategoryChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-all focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        selected
          ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/**
 * The one line that prevents a support call on day one.
 *
 * create_visit seeds the consultation charge from staff.consultation_fee, so an
 * admin who edits this price and sees bills unchanged has found the documented
 * behaviour, not a bug (services.price carries the same note in SQL).
 */
function ConsultationNote() {
  return (
    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
      The doctor&rsquo;s own fee wins on a visit &mdash;{' '}
      <Link href="/admin/staff" className="underline underline-offset-2 hover:text-foreground">
        set it on the staff record
      </Link>
      .
    </span>
  );
}

/** Putting a service back on the price list is not destructive: one click. */
function ReactivateButton({ service }: { service: ServiceRow }) {
  const [state, action] = useActionState(setServiceActive, IDLE);
  useToastOnResult(state);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={service.id} />
      <input type="hidden" name="is_active" value="true" />
      <SubmitButton size="xs" variant="ghost">
        Reactivate
      </SubmitButton>
    </form>
  );
}

function ServiceDialog({
  service,
  isNew,
  onClose,
}: {
  service: ServiceRow;
  isNew: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveService, IDLE);
  const [category, setCategory] = useState<ServiceCategory>(service.category);
  const [taxDraft, setTaxDraft] = useState(
    service.tax_rate ? String(service.tax_rate) : '',
  );

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const taxValue = Number(taxDraft.replace('%', '').trim());
  // A hint, never a block (CLAUDE.md 8): some procedures genuinely are taxable
  // and the hospital's accountant knows their business better than this form.
  const unusualTax = Number.isFinite(taxValue) && taxValue > 0 && !expectsTax(category);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New service' : service.name}</DialogTitle>
          <DialogDescription>
            Changing a price moves what the counter is offered next. Bills already raised keep the
            price they were raised at.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={service.id} />
          <input type="hidden" name="category" value={category} />

          <FormMessage state={state} />

          <Field label="Name" htmlFor="service-name" error={fieldError(state, 'name')} required>
            <Input
              id="service-name"
              name="name"
              defaultValue={service.name}
              maxLength={120}
              placeholder="Consultation - OPD"
              required
              autoFocus
              aria-invalid={fieldError(state, 'name') !== undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Category"
              htmlFor="service-category"
              error={fieldError(state, 'category')}
              required
            >
              {/* The Select posts nothing of its own here; the hidden input
                  above carries the value, the same arrangement the staff form
                  uses for its department picker. */}
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as ServiceCategory)}
              >
                <SelectTrigger id="service-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SERVICE_CATEGORY_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Price" htmlFor="service-price" error={fieldError(state, 'price')} required>
              <MoneyInput
                id="service-price"
                name="price"
                defaultValue={service.price ? String(service.price) : ''}
                placeholder="500.00"
                aria-invalid={fieldError(state, 'price') !== undefined}
              />
            </Field>

            <Field
              label="GST %"
              htmlFor="service-tax"
              error={fieldError(state, 'tax_rate')}
              hint={unusualTax ? undefined : 'Usually 0.'}
            >
              <Input
                id="service-tax"
                name="tax_rate"
                inputMode="decimal"
                autoComplete="off"
                value={taxDraft}
                onChange={(event) => setTaxDraft(event.target.value)}
                placeholder="0"
                className="text-right tabular-nums"
                aria-invalid={fieldError(state, 'tax_rate') !== undefined}
              />
            </Field>
          </div>

          {unusualTax ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Hospital services are usually GST-exempt; pharmacy items are not. {taxValue}% is
              allowed here &mdash; check it is what your accountant expects.
            </p>
          ) : null}

          {priceIsAdvisory(category) ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              On a visit, the doctor&rsquo;s consultation fee is charged instead of this price. Set
              that on the{' '}
              <Link href="/admin/staff" className="underline underline-offset-2">
                staff record
              </Link>
              . This price is what the counter offers when a consultation is added by hand.
            </p>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_active" defaultChecked={service.is_active} />
            Active
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving...">
              {isNew ? 'Create service' : 'Save changes'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A plain confirmation, deliberately not the typed one departments uses.
 *
 * CLAUDE.md 7 asks for a typed reason on destructive actions. This is not one:
 * charge_items snapshots its own price, so nothing that has been billed changes
 * and the row comes back with one click. Typing a service name here would be
 * friction bought with nothing.
 */
function DeactivateDialog({ service, onClose }: { service: ServiceRow; onClose: () => void }) {
  const [state, action] = useActionState(setServiceActive, IDLE);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Take {service.name} off the price list?</DialogTitle>
          <DialogDescription>
            Nothing is deleted. It stops appearing at the billing counter; bills already raised keep
            the price they were raised at, and you can put it back at any time.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={service.id} />
          <input type="hidden" name="is_active" value="false" />

          <FormMessage state={state} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton variant="destructive" pendingLabel="Working..." autoFocus>
              Deactivate
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Row-level actions have no dialog to report into, so they toast instead. */
function useToastOnResult(state: ActionState) {
  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
    if (state.status === 'error') toast.error(state.message);
  }, [state]);
}

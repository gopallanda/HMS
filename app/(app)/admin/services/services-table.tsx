'use client';

import Link from 'next/link';
import { PencilIcon, PlusIcon, ReceiptIndianRupeeIcon, SparklesIcon } from 'lucide-react';
import { Fragment, useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { loadStarterCatalogue, saveService, setServiceActive } from './actions';
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
  categoryOptions,
  defaultUnitFor,
  expectsTax,
  priceIsAdvisory,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_HINT,
  SERVICE_CATEGORY_LABEL,
  SERVICE_UNITS,
  SERVICE_UNIT_LABEL,
  SERVICE_UNIT_SUFFIX,
  type ServiceCategory,
  type ServiceUnit,
} from '@/lib/services';
import { formatAmount } from '@/lib/utils/money';

export type ServiceRow = {
  id: string;
  name: string;
  category: ServiceCategory;
  unit: ServiceUnit;
  price: number;
  tax_rate: number;
  is_active: boolean;
};

/**
 * The fee that is actually charged on a visit, per doctor.
 *
 * Not a price-list row and never editable here -- it lives on the staff record.
 * It is on this screen only because the consultation rows are meaningless
 * without it.
 */
export type DoctorFee = {
  id: string;
  full_name: string;
  consultation_fee: number;
};

/** The chip that means "no category filter". */
const ALL = '__all__';

function blankService(category: ServiceCategory | null): ServiceRow {
  // A new row lands in whichever category is being looked at -- filtering to
  // Lab and pressing N almost always means "another lab test". Pharmacy is the
  // one category that cannot be created into, so a new row started from that
  // filter falls back rather than opening a form that refuses its own default.
  const chosen: ServiceCategory =
    category && category !== 'pharmacy' ? category : 'consultation';

  // Minted here, not in Postgres: a resubmitted form then updates the row it
  // already created instead of adding a second one (CLAUDE.md 7).
  return {
    id: crypto.randomUUID(),
    name: '',
    category: chosen,
    unit: defaultUnitFor(chosen),
    price: 0,
    tax_rate: 0,
    is_active: true,
  };
}

export function ServicesTable({
  services,
  doctors,
}: {
  services: ServiceRow[];
  doctors: DoctorFee[];
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ServiceCategory | typeof ALL>(ALL);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [deactivating, setDeactivating] = useState<ServiceRow | null>(null);
  const [starter, setStarter] = useState(false);
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
        {/* Always offered, not only on an empty list: it adds what is missing
            and touches nothing that exists, so a hospital three months in can
            still pull the eleven lab tests it never got round to typing. */}
        <Button variant="outline" onClick={() => setStarter(true)}>
          <SparklesIcon data-icon="inline-start" />
          Standard list
        </Button>
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
                        ? 'Nothing can be billed until this list exists. One row is one billable thing — a consultation, a dressing, one lab test, one ward class per night. The categories are only how they are filed. Load the standard list and edit the prices to your own rates.'
                        : undefined
                    }
                    action={
                      services.length === 0 ? (
                        <div className="flex flex-wrap justify-center gap-2">
                          <Button onClick={() => setStarter(true)}>
                            <SparklesIcon data-icon="inline-start" />
                            Load the standard list
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setEditing(blankService('consultation'))}
                          >
                            <PlusIcon data-icon="inline-start" />
                            Add one myself
                          </Button>
                        </div>
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
                        {priceIsAdvisory(service.category) ? (
                          <ConsultationNote doctors={doctors} />
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAmount(service.price)}
                        {/* The unit sits with the number, not in a column of
                            its own: "3,000.00 / day" is one fact, and `each`
                            prints nothing so the four rows where the unit
                            matters are the four that stand out. */}
                        {SERVICE_UNIT_SUFFIX[service.unit] ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {SERVICE_UNIT_SUFFIX[service.unit]}
                          </span>
                        ) : null}
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
          doctors={doctors}
          isNew={!services.some((row) => row.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {starter ? (
        <StarterDialog hasServices={services.length > 0} onClose={() => setStarter(false)} />
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
 * The one line that prevents a support call on day one -- now with the numbers
 * in it.
 *
 * register_patient_visit charges staff.consultation_fee, not this row's price,
 * so an admin who edits the price and sees bills unchanged has found documented
 * behaviour rather than a bug. Saying so was already here; saying so while
 * showing the fees that ARE charged is what makes it believable, and it catches
 * the failure nobody goes looking for -- a doctor whose fee is still zero, who
 * has been seen free of charge since the day they were added.
 */
function ConsultationNote({ doctors }: { doctors: DoctorFee[] }) {
  if (doctors.length === 0) {
    return (
      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
        No active doctor yet. A visit charges the doctor&rsquo;s own fee, so{' '}
        <Link href="/admin/staff" className="underline underline-offset-2 hover:text-foreground">
          add one and set their fee
        </Link>
        .
      </span>
    );
  }

  // Four names, then a count. A hospital with fifteen doctors would otherwise
  // push every other row off the screen, and the point of the line is made by
  // the first two.
  const shown = doctors.slice(0, 4);
  const rest = doctors.length - shown.length;

  return (
    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
      Charged on a visit:{' '}
      {shown.map((doctor, index) => (
        <Fragment key={doctor.id}>
          {index > 0 ? <span aria-hidden> &middot; </span> : null}
          <span className={cn(doctor.consultation_fee === 0 && 'text-destructive')}>
            {doctor.full_name} {formatAmount(doctor.consultation_fee)}
          </span>
        </Fragment>
      ))}
      {rest > 0 ? ` and ${rest} more` : null}
      {' — '}
      <Link href="/admin/staff" className="underline underline-offset-2 hover:text-foreground">
        set on the staff record
      </Link>
      .
    </span>
  );
}

/**
 * Load the standard tariff.
 *
 * A confirmation rather than a bare button, because the honest description of
 * what it does is the whole reassurance: it only ADDS, and only names that are
 * missing. Nothing here is destructive, so there is no typed reason
 * (CLAUDE.md 7) -- and the prices are said to be placeholders twice, here and
 * in the toast, because an owner who trusts them is the one real risk.
 */
function StarterDialog({ hasServices, onClose }: { hasServices: boolean; onClose: () => void }) {
  const [state, action] = useActionState(loadStarterCatalogue, IDLE);

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
          <DialogTitle>Load the standard price list?</DialogTitle>
          <DialogDescription>
            About thirty rows a small hospital bills every day: three consultation lines, nine
            procedures, eleven lab tests, four ward classes per night, and the non-clinical charges.
            No medicines &mdash; a drug&rsquo;s price belongs to the batch it came in on.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <FormMessage state={state} />

          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            The prices are placeholders. Edit every one of them to your own rates before the counter
            opens.
            {hasServices
              ? ' Anything you already have is skipped by name, so no price of yours is touched.'
              : ''}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Adding..." autoFocus>
              Add the standard list
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  doctors,
  isNew,
  onClose,
}: {
  service: ServiceRow;
  doctors: DoctorFee[];
  isNew: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveService, IDLE);
  const [category, setCategory] = useState<ServiceCategory>(service.category);
  const [unit, setUnit] = useState<ServiceUnit>(service.unit);
  const [unitTouched, setUnitTouched] = useState(false);
  const [taxDraft, setTaxDraft] = useState(
    service.tax_rate ? String(service.tax_rate) : '',
  );

  /**
   * The unit follows the category until somebody sets it by hand.
   *
   * Picking Bed and leaving the unit on `each` is how a ward rate silently
   * becomes a one-off charge, and the person picking Bed has already said what
   * they mean. One deliberate change to the field ends the tracking for good --
   * a ward billed per hour is unusual, not wrong.
   */
  const options = categoryOptions(service.category);

  function chooseCategory(next: ServiceCategory) {
    setCategory(next);
    if (!unitTouched) setUnit(defaultUnitFor(next));
  }

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
            {isNew
              ? 'One row is one billable thing — a single test, a single procedure, one ward class. Changing a price later moves what the counter is offered next; bills already raised keep the price they were raised at.'
              : 'Changing a price moves what the counter is offered next. Bills already raised keep the price they were raised at.'}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={service.id} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="unit" value={unit} />

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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Category"
              htmlFor="service-category"
              error={fieldError(state, 'category')}
              hint={SERVICE_CATEGORY_HINT[category]}
              required
            >
              {/* The Select posts nothing of its own here; the hidden input
                  above carries the value, the same arrangement the staff form
                  uses for its department picker. */}
              <Select
                value={category}
                onValueChange={(value) => chooseCategory(value as ServiceCategory)}
              >
                <SelectTrigger id="service-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SERVICE_CATEGORY_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Beside the category, because the two are read together: "Bed,
                per day" is the whole sentence. Nothing enforces it yet -- Phase
                3 is what multiplies a bed rate by nights stayed -- but the name
                field is where this meaning used to live, and free text cannot
                be multiplied by anything. */}
            <Field
              label="Charged"
              htmlFor="service-unit"
              hint={unit === 'each' ? 'A one-off charge.' : `Quantity is counted in ${SERVICE_UNIT_LABEL[unit].toLowerCase().replace('per ', '')}s.`}
            >
              <Select
                value={unit}
                onValueChange={(value) => {
                  setUnit(value as ServiceUnit);
                  setUnitTouched(true);
                }}
              >
                <SelectTrigger id="service-unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_UNITS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SERVICE_UNIT_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="grid gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <p>
                On a visit, the doctor&rsquo;s own consultation fee is charged instead of this
                price. This price is only what the counter offers when a consultation is added by
                hand.
              </p>
              {doctors.length === 0 ? (
                <p>
                  No active doctor has a fee yet &mdash;{' '}
                  <Link href="/admin/staff" className="underline underline-offset-2">
                    add one on the staff record
                  </Link>
                  .
                </p>
              ) : (
                <ul className="grid gap-0.5">
                  {doctors.map((doctor) => (
                    <li key={doctor.id} className="flex justify-between gap-4 tabular-nums">
                      <span>{doctor.full_name}</span>
                      {/* Zero is the case worth shouting about: it bills a
                          consultation at nothing, every time, quietly. */}
                      <span className={cn(doctor.consultation_fee === 0 && 'text-destructive')}>
                        {formatAmount(doctor.consultation_fee)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {category === 'pharmacy' ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Pharmacy is no longer offered on new rows. A drug&rsquo;s price belongs to the batch it
              was bought in, so it will come from stock when the pharmacy module lands
              &mdash; this row still edits and still bills until then.
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

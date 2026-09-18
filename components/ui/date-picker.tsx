'use client';

import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/**
 * The app's date field. Replaces `<input type="date">` everywhere.
 *
 * The native control looks different in every browser, cannot be styled to
 * match the rest of a form, and on Android opens a full-screen OS dialog that
 * has nothing to do with this product. This one is a calendar in a popover with
 * a month and a year view -- so a date of birth in 1968 is three taps, not
 * sixty presses of "previous month".
 *
 * It still posts as a plain form field: a hidden input carries the value as
 * `YYYY-MM-DD`, the same string the native control sent, so no Server Action,
 * schema or GET filter had to change. It also listens for its form's `reset`,
 * because React resets uncontrolled fields after an action and a hidden input
 * with state behind it would otherwise keep the last patient's birthday.
 *
 * `typeable` puts a text box in the trigger that accepts DD/MM/YYYY. The front
 * desk is keyboard-first (CLAUDE.md 7), and a clerk who knows the date is
 * faster typing eight digits than opening any calendar.
 */

type View = 'days' | 'months' | 'years';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type Ymd = { y: number; m: number; d: number };

function parseIso(value: string | undefined | null): Ymd | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function toIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Today in India, whatever the device clock's zone is set to. */
function todayYmd(): Ymd {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parseIso(parts) as Ymd;
}

function formatDisplay(v: Ymd): string {
  return `${String(v.d).padStart(2, '0')} ${MONTHS[v.m]} ${v.y}`;
}

function formatTyped(v: Ymd): string {
  return `${String(v.d).padStart(2, '0')}/${String(v.m + 1).padStart(2, '0')}/${v.y}`;
}

/** "15081990", "15/8/1990", "15-08-1990" -> a date, or null if not one. */
function parseTyped(text: string): Ymd | null {
  const digits = text.replace(/\D/g, '');
  let d: number, m: number, y: number;
  const parts = text.split(/[/.\-\s]+/).filter(Boolean);
  if (parts.length === 3) {
    [d, m, y] = parts.map(Number) as [number, number, number];
  } else if (digits.length === 8) {
    d = Number(digits.slice(0, 2));
    m = Number(digits.slice(2, 4));
    y = Number(digits.slice(4));
  } else {
    return null;
  }
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m - 1)) return null;
  return { y, m: m - 1, d };
}

/** Inserts the slashes as the clerk types digits. */
function maskTyped(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function compare(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

function addDays(v: Ymd, n: number): Ymd {
  const date = new Date(Date.UTC(v.y, v.m, v.d + n));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() };
}

export type DatePickerProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** YYYY-MM-DD, inclusive. */
  min?: string;
  max?: string;
  placeholder?: string;
  /** Accept DD/MM/YYYY typed into the field as well as a pick. */
  typeable?: boolean;
  /** Show an × that empties the field. */
  clearable?: boolean;
  /** Submit the enclosing form on pick. For filter bars with nothing else to set. */
  autoSubmit?: boolean;
  /** Open on the year grid when empty: the right start for a date of birth. */
  startView?: View;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

export function DatePicker({
  id,
  name,
  value: controlled,
  defaultValue,
  onValueChange,
  min,
  max,
  placeholder,
  typeable = false,
  clearable = false,
  autoSubmit = false,
  startView = 'days',
  disabled,
  className,
  ...aria
}: DatePickerProps) {
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const value = controlled ?? inner;
  const selected = parseIso(value);
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState(selected ? formatTyped(selected) : '');
  const hiddenRef = React.useRef<HTMLInputElement>(null);
  const minYmd = parseIso(min);
  const maxYmd = parseIso(max);

  // Keep the typed text in step with a value that changed from outside.
  const [shownFor, setShownFor] = React.useState(value);
  if (shownFor !== value) {
    setShownFor(value);
    setTyped(selected ? formatTyped(selected) : '');
  }

  const commit = React.useCallback(
    (next: string, submit = false) => {
      if (controlled === undefined) setInner(next);
      onValueChange?.(next);
      if (submit && autoSubmit) {
        // After React has written the hidden input, or the form posts the old day.
        requestAnimationFrame(() => hiddenRef.current?.form?.requestSubmit());
      }
    },
    [autoSubmit, controlled, onValueChange],
  );

  React.useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const onReset = () => {
      if (controlled === undefined) setInner(defaultValue ?? '');
    };
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [controlled, defaultValue]);

  const pick = (next: Ymd) => {
    commit(toIso(next), true);
    setOpen(false);
  };

  const inputClass =
    'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-xl border border-input bg-background px-3.5 text-left text-base transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:h-8 md:gap-2 md:rounded-lg md:px-2.5 md:text-sm dark:bg-input/30';

  const clearButton =
    clearable && value && !disabled ? (
      <span
        role="button"
        tabIndex={-1}
        aria-label="Clear date"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          commit('', true);
        }}
        className="-mr-1 grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </span>
    ) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <input ref={hiddenRef} type="hidden" name={name} value={value} />

      {typeable ? (
        <PopoverAnchor asChild>
          <div
            className={cn(inputClass, disabled && 'pointer-events-none opacity-50', className)}
            aria-invalid={aria['aria-invalid']}
          >
            <input
              id={id}
              value={typed}
              disabled={disabled}
              inputMode="numeric"
              autoComplete="off"
              placeholder={placeholder ?? 'DD/MM/YYYY'}
              aria-describedby={aria['aria-describedby']}
              aria-invalid={aria['aria-invalid']}
              onChange={(event) => {
                const text = maskTyped(event.target.value);
                setTyped(text);
                const parsed = parseTyped(text);
                if (parsed) commit(toIso(parsed));
                else if (text === '') commit('');
              }}
              onBlur={() => {
                // A half-typed date is not a date: put back what is really held.
                if (!parseTyped(typed)) setTyped(selected ? formatTyped(selected) : '');
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && event.altKey) {
                  event.preventDefault();
                  setOpen(true);
                }
              }}
              className="min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground"
            />
            {clearButton}
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label="Open calendar"
              className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:-mr-1 md:size-6"
            >
              <CalendarDaysIcon className="size-[18px] md:size-4" />
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
      ) : (
        <PopoverTrigger
          id={id}
          type="button"
          disabled={disabled}
          aria-invalid={aria['aria-invalid']}
          aria-describedby={aria['aria-describedby']}
          className={cn(inputClass, 'disabled:cursor-not-allowed disabled:opacity-50', className)}
        >
          <CalendarDaysIcon className="size-[18px] shrink-0 text-muted-foreground md:size-4" />
          <span
            className={cn('min-w-0 flex-1 truncate tabular-nums', !selected && 'text-muted-foreground')}
          >
            {selected ? formatDisplay(selected) : (placeholder ?? 'Pick a date')}
          </span>
          {clearButton}
        </PopoverTrigger>
      )}

      <PopoverContent
        className="w-[min(20.5rem,calc(100vw-1.5rem))] p-3 md:w-72"
        onOpenAutoFocus={(event) => {
          // Focus the day, not the header's first button, so arrows work at once.
          event.preventDefault();
          requestAnimationFrame(() => {
            const target = document.querySelector<HTMLElement>('[data-calendar-focus="true"]');
            target?.focus();
          });
        }}
      >
        <Calendar
          selected={selected}
          min={minYmd}
          max={maxYmd}
          startView={startView}
          onPick={pick}
          onClear={
            clearable || typeable
              ? () => {
                  commit('', true);
                  setOpen(false);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}

function Calendar({
  selected,
  min,
  max,
  startView,
  onPick,
  onClear,
}: {
  selected: Ymd | null;
  min: Ymd | null;
  max: Ymd | null;
  startView: View;
  onPick: (value: Ymd) => void;
  onClear?: () => void;
}) {
  const [today] = React.useState(todayYmd);
  const anchor = selected ?? (max && compare(max, today) < 0 ? max : today);
  const [view, setView] = React.useState<View>(selected ? 'days' : startView);
  const [cursor, setCursor] = React.useState<Ymd>(anchor);
  const year = cursor.y;
  const month = cursor.m;

  const outOfRange = (v: Ymd) => (min && compare(v, min) < 0) || (max && compare(v, max) > 0);
  const monthOut = (y: number, m: number) =>
    (min && (y < min.y || (y === min.y && m < min.m))) ||
    (max && (y > max.y || (y === max.y && m > max.m)));
  const yearOut = (y: number) => (min && y < min.y) || (max && y > max.y);

  const shiftMonth = (n: number) => {
    const date = new Date(Date.UTC(year, month + n, 1));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    setCursor({ y, m, d: Math.min(cursor.d, daysIn(y, m)) });
  };

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const total = daysIn(year, month);
  const cells: (Ymd | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: total }, (_, index) => ({ y: year, m: month, d: index + 1 })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const yearPageStart = year - (((year % 12) + 12) % 12);

  const onGridKey = (event: React.KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      const next = addDays(cursor, moves[event.key]!);
      setCursor(next);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-calendar-focus="true"]')?.focus(),
      );
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      shiftMonth(event.key === 'PageUp' ? -1 : 1);
    }
  };

  const title =
    view === 'days'
      ? `${MONTHS_LONG[month]} ${year}`
      : view === 'months'
        ? String(year)
        : `${yearPageStart} – ${yearPageStart + 11}`;

  const step = (direction: -1 | 1) => {
    if (view === 'days') shiftMonth(direction);
    else if (view === 'months') setCursor({ ...cursor, y: year + direction });
    else setCursor({ ...cursor, y: year + direction * 12 });
  };

  const navButton =
    'grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:size-8';

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setView(view === 'days' ? 'years' : view === 'months' ? 'years' : 'days')}
          className="flex h-9 flex-1 items-center gap-1 rounded-full px-2.5 text-[15px] font-semibold tracking-tight transition-colors hover:bg-muted md:h-8 md:text-sm"
          aria-label={`${title}. Change view`}
        >
          {title}
          <ChevronRightIcon
            className={cn('size-4 text-muted-foreground transition-transform', view !== 'days' && 'rotate-90')}
          />
        </button>
        <button type="button" className={navButton} onClick={() => step(-1)} aria-label="Previous">
          <ChevronLeftIcon className="size-4" />
        </button>
        <button type="button" className={navButton} onClick={() => step(1)} aria-label="Next">
          <ChevronRightIcon className="size-4" />
        </button>
      </div>

      {view === 'days' ? (
        <div role="grid" onKeyDown={onGridKey}>
          <div className="mb-1 grid grid-cols-7">
            {WEEKDAYS.map((day) => (
              <span
                key={day}
                className="grid h-8 place-items-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((cell, index) => {
              if (!cell) return <span key={`blank-${index}`} />;
              const isSelected = selected && compare(cell, selected) === 0;
              const isToday = compare(cell, today) === 0;
              const isCursor = compare(cell, cursor) === 0;
              const disabled = Boolean(outOfRange(cell));
              return (
                <button
                  key={cell.d}
                  type="button"
                  role="gridcell"
                  disabled={disabled}
                  tabIndex={isCursor ? 0 : -1}
                  data-calendar-focus={isCursor ? 'true' : undefined}
                  aria-selected={Boolean(isSelected)}
                  aria-label={formatDisplay(cell)}
                  onClick={() => onPick(cell)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (!disabled) onPick(cell);
                    }
                  }}
                  className={cn(
                    'mx-auto grid size-10 place-items-center rounded-full text-sm tabular-nums transition-colors outline-none md:size-9',
                    'focus-visible:ring-3 focus-visible:ring-ring/50',
                    isSelected
                      ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                      : isToday
                        ? 'font-semibold text-primary ring-1 ring-primary/40 hover:bg-primary/10'
                        : 'hover:bg-muted',
                    disabled && 'pointer-events-none text-muted-foreground/35',
                  )}
                >
                  {cell.d}
                </button>
              );
            })}
          </div>
        </div>
      ) : view === 'months' ? (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {MONTHS.map((label, m) => {
            const active = selected && selected.y === year && selected.m === m;
            const disabled = Boolean(monthOut(year, m));
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                data-calendar-focus={m === month ? 'true' : undefined}
                onClick={() => {
                  setCursor({ y: year, m, d: Math.min(cursor.d, daysIn(year, m)) });
                  setView('days');
                }}
                className={cn(
                  'h-12 rounded-xl text-sm font-medium transition-colors md:h-10',
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  disabled && 'pointer-events-none text-muted-foreground/35',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, index) => yearPageStart + index).map((y) => {
            const active = selected?.y === y;
            const disabled = Boolean(yearOut(y));
            return (
              <button
                key={y}
                type="button"
                disabled={disabled}
                data-calendar-focus={y === year ? 'true' : undefined}
                onClick={() => {
                  setCursor({ y, m: month, d: Math.min(cursor.d, daysIn(y, month)) });
                  setView('months');
                }}
                className={cn(
                  'h-12 rounded-xl text-sm font-medium tabular-nums transition-colors md:h-10',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : y === today.y
                      ? 'text-primary ring-1 ring-primary/40 ring-inset hover:bg-primary/10'
                      : 'hover:bg-muted',
                  disabled && 'pointer-events-none text-muted-foreground/35',
                )}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="h-9 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:h-8"
          >
            Clear
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={Boolean(outOfRange(today))}
          onClick={() => onPick(today)}
          className="h-9 rounded-full px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40 md:h-8"
        >
          Today
        </button>
      </div>
    </div>
  );
}

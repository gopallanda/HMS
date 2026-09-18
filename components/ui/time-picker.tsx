'use client';

import { ClockIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/**
 * The app's time field. Replaces `<input type="time">`.
 *
 * Two scrolling columns, hours and minutes, in a popover -- the same shape on
 * every phone and every desk browser. Posts `HH:MM` through a hidden input,
 * exactly what the native control sent, so the roster action is unchanged.
 * Shows the 12-hour reading beside the 24-hour value, because "14:30" is the
 * stored truth but "2:30 PM" is how a ward says it.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function parse(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function twelveHour(h: number, m: number) {
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${suffix}`;
}

export function TimePicker({
  id,
  name,
  defaultValue,
  value: controlled,
  onValueChange,
  placeholder = 'Set time',
  minuteStep = 5,
  className,
  disabled,
  ...aria
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  minuteStep?: number;
  className?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const value = controlled ?? inner;
  const parsed = parse(value);
  const [open, setOpen] = React.useState(false);
  const hiddenRef = React.useRef<HTMLInputElement>(null);

  const minutes = React.useMemo(() => {
    const list = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
    // A shift saved at 09:07 elsewhere must still show as selected here.
    if (parsed && !list.includes(parsed.m)) list.push(parsed.m);
    return list.sort((a, b) => a - b);
  }, [minuteStep, parsed]);

  const commit = (next: string) => {
    if (controlled === undefined) setInner(next);
    onValueChange?.(next);
  };

  React.useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const onReset = () => {
      if (controlled === undefined) setInner(defaultValue ?? '');
    };
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [controlled, defaultValue]);

  const hourList = React.useRef<HTMLDivElement>(null);
  const minuteList = React.useRef<HTMLDivElement>(null);

  // Bring the selected hour and minute into the middle of their columns.
  const centreSelection = () => {
    for (const list of [hourList.current, minuteList.current]) {
      const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (list && active) list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2;
    }
  };

  const cell =
    'h-10 w-full shrink-0 rounded-xl text-sm font-medium tabular-nums transition-colors md:h-8 md:rounded-lg';

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) requestAnimationFrame(centreSelection);
      }}
    >
      <input ref={hiddenRef} type="hidden" name={name} value={value} />
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        aria-invalid={aria['aria-invalid']}
        className={cn(
          'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-xl border border-input bg-background px-3.5 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:h-8 md:gap-2 md:rounded-lg md:px-2.5 md:text-sm dark:bg-input/30',
          className,
        )}
      >
        <ClockIcon className="size-[18px] shrink-0 text-muted-foreground md:size-4" />
        {parsed ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 tabular-nums">
            <span>
              {pad(parsed.h)}:{pad(parsed.m)}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {twelveHour(parsed.h, parsed.m)}
            </span>
          </span>
        ) : (
          <span className="flex-1 text-muted-foreground">{placeholder}</span>
        )}
        {parsed && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear time"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              commit('');
            }}
            className="-mr-1 grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent className="w-60 p-2">
        <div className="grid grid-cols-2 gap-2">
          <p className="text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Hour
          </p>
          <p className="text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Minute
          </p>
          <div
            ref={hourList}
            role="listbox"
            aria-label="Hour"
            className="custom-scrollbar relative flex h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain"
          >
            {HOURS.map((h) => {
              const active = parsed?.h === h;
              return (
                <button
                  key={h}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => commit(`${pad(h)}:${pad(parsed?.m ?? 0)}`)}
                  className={cn(cell, active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                >
                  {pad(h)}
                </button>
              );
            })}
          </div>
          <div
            ref={minuteList}
            role="listbox"
            aria-label="Minute"
            className="custom-scrollbar relative flex h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain"
          >
            {minutes.map((m) => {
              const active = parsed?.m === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    commit(`${pad(parsed?.h ?? 9)}:${pad(m)}`);
                    setOpen(false);
                  }}
                  className={cn(cell, active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                >
                  {pad(m)}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

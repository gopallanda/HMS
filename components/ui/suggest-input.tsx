'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * A text box with suggestions under it. Replaces `<input list>` + `<datalist>`.
 *
 * The native datalist renders as a different OS widget on every browser (and
 * barely at all on some Android keyboards), so it could never match the rest of
 * the form. This keeps what made the datalist right -- the suggestions are
 * suggestions, and anything can still be typed -- and draws the list itself.
 *
 * The list sits in the flow of a relatively positioned wrapper rather than a
 * portal: it never steals focus from the field, which is the whole contract of
 * an autocomplete. Up and Down move, Enter picks, Escape closes.
 */
export function SuggestInput({
  suggestions,
  value,
  onValueChange,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'list'> & {
  suggestions: readonly string[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(-1);
  const id = React.useId();

  const needle = value.trim().toLowerCase();
  const matches = suggestions.filter(
    (option) => option.toLowerCase() !== needle && (needle === '' || option.toLowerCase().includes(needle)),
  );
  const showing = open && !disabled && matches.length > 0;

  function pick(option: string) {
    onValueChange(option);
    setOpen(false);
    setCursor(-1);
  }

  return (
    <div className="relative">
      <Input
        {...props}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setCursor(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!showing) {
            if (event.key === 'ArrowDown') setOpen(true);
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setCursor((current) => (current + 1) % matches.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor((current) => (current <= 0 ? matches.length - 1 : current - 1));
          } else if (event.key === 'Enter' && cursor >= 0) {
            event.preventDefault();
            pick(matches[cursor]!);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={showing}
        aria-controls={id}
        aria-autocomplete="list"
        autoComplete="off"
        className={className}
      />
      {showing ? (
        <ul
          id={id}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 md:rounded-lg"
        >
          {matches.map((option, index) => (
            <li
              key={option}
              role="option"
              aria-selected={index === cursor}
              // mousedown, not click: the field must not blur before the pick.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              onMouseMove={() => setCursor(index)}
              className={cn(
                'cursor-pointer rounded-lg px-3 py-2.5 font-mono text-sm md:rounded-md md:px-2 md:py-1.5',
                index === cursor ? 'bg-accent text-accent-foreground' : '',
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

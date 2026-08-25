'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * Amount entry.
 *
 * Right aligned and tabular, with the rupee sign in its own tinted cap at the
 * left edge (CLAUDE.md 7). inputMode="decimal" so an Android tablet at the
 * counter opens the number pad, but the control stays a text input on purpose:
 * type="number" silently swallows a stray keystroke as an empty value and lets
 * the mouse wheel change an amount while the field has focus. Parsing happens
 * in lib/schemas/form.ts, on both sides of the wire.
 *
 * The cap is a sibling in a flex row rather than an absolutely positioned
 * overlay, so it grows with the field: the collect screen renders this at
 * `h-12 text-2xl` and the rupee sign has to grow with it, not float in the
 * middle of a taller box.
 */
export function MoneyInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <div className="flex w-full items-stretch">
      <span
        aria-hidden
        className="flex shrink-0 items-center rounded-l-lg border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground"
      >
        ₹
      </span>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('rounded-l-none text-right font-medium tabular-nums', className)}
        {...props}
      />
    </div>
  );
}

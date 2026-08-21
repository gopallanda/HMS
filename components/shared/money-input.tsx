'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * Amount entry.
 *
 * Right aligned and tabular, with the rupee sign fixed at the left edge
 * (CLAUDE.md 7). inputMode="decimal" so an Android tablet at the counter opens
 * the number pad, but the control stays a text input on purpose: type="number"
 * silently swallows a stray keystroke as an empty value and lets the mouse
 * wheel change an amount while the field has focus. Parsing happens in
 * lib/schemas/form.ts, on both sides of the wire.
 */
export function MoneyInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">
        ₹
      </span>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('pl-6 text-right tabular-nums', className)}
        {...props}
      />
    </div>
  );
}

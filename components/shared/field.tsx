import { CircleAlertIcon } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * Label, control, and the field's own error, in one compact stack.
 *
 * Errors sit under the field they belong to rather than being collected into a
 * list at the top, so a form with four problems takes one glance instead of
 * four. `error` also drives aria-invalid on the control via the `data-invalid`
 * attribute the caller spreads.
 *
 * The label is foreground weight, not muted: it is the thing a clerk scans down
 * a column of fields to find, and a muted label on a muted hint below it gives
 * the eye nothing to catch.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          className="flex items-center gap-1.5 text-xs font-medium text-destructive"
        >
          <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

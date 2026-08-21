import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * Label, control, and the field's own error, in one compact stack.
 *
 * Errors sit under the field they belong to rather than being collected into a
 * list at the top, so a form with four problems takes one glance instead of
 * four. `error` also drives aria-invalid on the control via the `data-invalid`
 * attribute the caller spreads.
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
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

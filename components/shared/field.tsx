import { CircleAlertIcon } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * Label, control, and a FIXED-HEIGHT slot for the hint or the error.
 *
 * The reserved slot is the whole point (block 6.1). Before it, a validation
 * error appearing under one field pushed that column down and left its
 * neighbours sitting on a different baseline -- which is what the screenshot in
 * the brief is showing. Two fields side by side, one with a hint and one
 * without, had the same problem before anybody typed anything.
 *
 * So the slot is always there, always one line tall, and shows the error when
 * there is one, the hint otherwise, and nothing when there is neither. Nothing
 * below the row moves, ever.
 *
 * The cost is one line of vertical space per field on a form with no hints. On
 * a data-dense work screen that is worth paying: a row that jumps under the
 * cursor costs a re-read every time it happens, all day.
 *
 * `hintLines` widens the slot for a two-line hint -- used by the age fieldset,
 * whose explanation genuinely needs the room. Every field in the same ROW must
 * be given the same value, or the reservation stops doing its job.
 *
 * Errors sit under the field they belong to rather than being collected into a
 * list at the top, so a form with four problems takes one glance instead of
 * four.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  hintLines = 1,
  /** Drop the reserved slot. Only for a field that is alone in its row. */
  collapse = false,
  children,
}: {
  label?: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  hintLines?: 1 | 2;
  collapse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
      ) : null}

      {children}

      {collapse && !error && !hint ? null : (
        <div className={cn('grid', hintLines === 2 ? 'min-h-8' : 'min-h-4')}>
          {error ? (
            <p
              id={`${htmlFor}-error`}
              className="flex items-start gap-1.5 text-xs leading-4 font-medium text-destructive"
            >
              <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : hint ? (
            <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * A bordered group of controls that are really one input with two entry modes.
 *
 * Used for date of birth and age (block 6.3): the desk fills in whichever the
 * patient can answer, and the box around them is what says so. Two loose
 * fields sitting next to each other, one labelled "or age in years", read as
 * two questions and get two answers.
 */
export function FieldSet({
  legend,
  hint,
  error,
  className,
  children,
}: {
  legend: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className={cn(
        'grid content-start gap-1.5 rounded-lg border border-border/70 px-3 pt-2 pb-2.5',
        className,
      )}
    >
      <legend className="px-1 text-sm font-medium text-foreground">{legend}</legend>
      {children}
      <div className="min-h-8">
        {error ? (
          <p className="flex items-start gap-1.5 text-xs leading-4 font-medium text-destructive">
            <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </fieldset>
  );
}

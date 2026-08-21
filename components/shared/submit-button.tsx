'use client';

import { Loader2Icon } from 'lucide-react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * A submit button that knows whether its own form is in flight.
 *
 * useFormStatus reads the enclosing <form>, so this works without threading a
 * `pending` flag through every component in between. Disabled while pending:
 * double-submitting a staff form is harmless, double-submitting a payment in
 * Phase 1 is not, and the habit should be the same in both places.
 */
export function SubmitButton({
  children,
  className,
  pendingLabel,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      // Both reasons to be disabled, not whichever was written last.
      disabled={pending || disabled}
      className={cn(className)}
      {...props}
    >
      {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}

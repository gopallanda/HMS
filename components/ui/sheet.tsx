'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * A panel that slides in from an edge.
 *
 * The one place this is needed is the navigation on a phone, where a 240px rail
 * would leave nothing for the work. It is Radix's Dialog rather than a
 * hand-rolled overlay so the drawer keeps a focus trap, Escape-to-close and
 * `aria-modal` for free -- the app is keyboard-first by rule (CLAUDE.md 7), and
 * a nav you can tab out of behind the scrim is worse than no drawer at all.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = 'left',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right';
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 z-50 flex w-[17rem] max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl duration-200 outline-none data-open:animate-in data-closed:animate-out',
          side === 'left'
            ? 'left-0 border-r data-open:slide-in-from-left data-closed:slide-out-to-left'
            : 'right-0 border-l data-open:slide-in-from-right data-closed:slide-out-to-right',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

const SheetTitle = DialogPrimitive.Title;
const SheetDescription = DialogPrimitive.Description;

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetDescription,
};

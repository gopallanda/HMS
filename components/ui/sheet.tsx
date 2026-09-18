'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { useRef } from 'react';

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
  side?: 'left' | 'right' | 'bottom';
  showCloseButton?: boolean;
}) {
  const { contentRef, closeRef, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } =
    useDragToDismiss();
  const bottom = side === 'bottom';

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        ref={bottom ? contentRef : undefined}
        onTouchStart={bottom ? onTouchStart : undefined}
        onTouchMove={bottom ? onTouchMove : undefined}
        onTouchEnd={bottom ? onTouchEnd : undefined}
        onTouchCancel={bottom ? onTouchCancel : undefined}
        className={cn(
          'fixed z-50 flex flex-col shadow-xl duration-200 outline-none data-open:animate-in data-closed:animate-out',
          side === 'bottom'
            ? // The phone's menu: a card that rises from the tab bar, with a grab
              // handle so it reads as something that can be pulled away.
              // data-dragged drops the exit animation: the finger has already
              // carried the sheet off the screen, and replaying the slide from
              // the top would bounce it back into view first.
              'inset-x-0 bottom-0 max-h-[88svh] touch-pan-y rounded-t-3xl border-t bg-background pb-[env(safe-area-inset-bottom)] text-foreground data-open:slide-in-from-bottom data-closed:slide-out-to-bottom data-[dragged]:animate-none'
            : 'inset-y-0 w-[17rem] max-w-[85vw] bg-sidebar text-sidebar-foreground',
          side === 'left' && 'left-0 border-r data-open:slide-in-from-left data-closed:slide-out-to-left',
          side === 'right' && 'right-0 border-l data-open:slide-in-from-right data-closed:slide-out-to-right',
          className,
        )}
        {...props}
      >
        {side === 'bottom' ? (
          // The grab handle, in a strip tall enough to land a thumb on. A drag
          // that starts here always moves the sheet, whatever is scrolled.
          <span data-sheet-handle aria-hidden className="flex h-6 shrink-0 cursor-grab justify-center pt-2.5">
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
          </span>
        ) : null}
        {side === 'bottom' ? (
          <DialogPrimitive.Close ref={closeRef} className="hidden" tabIndex={-1} aria-hidden />
        ) : null}
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

/** Pulled this far down, the sheet closes on release. */
const DISMISS_DISTANCE = 96;
/** Or flicked down at least this fast (px per ms), however short the pull. */
const DISMISS_VELOCITY = 0.5;

/**
 * Pull a bottom sheet down to close it, the way every phone app's sheet works.
 *
 * Hand-rolled on touch events rather than a drawer library: it is forty lines,
 * and swapping the Radix Dialog underneath would cost the focus trap and
 * Escape handling the sheet is built on.
 *
 * A drag begins only when it cannot be a scroll: from the handle, or anywhere
 * in the sheet while the list inside is already at its top. The sheet follows
 * the finger through a transform written straight to the element -- no React
 * render per frame -- and on release either slides the rest of the way and
 * closes, or springs back.
 */
function useDragToDismiss() {
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ startY: number; startAt: number; dy: number; active: boolean } | null>(
    null,
  );

  function scrolledAncestor(target: EventTarget | null): boolean {
    let node = target instanceof HTMLElement ? target : null;
    while (node && node !== contentRef.current) {
      if (node.scrollTop > 0) return true;
      node = node.parentElement;
    }
    return false;
  }

  function setOffset(dy: number, animate: boolean) {
    const node = contentRef.current;
    if (!node) return;
    node.style.transition = animate ? 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none';
    node.style.transform = dy === 0 ? '' : `translateY(${dy}px)`;
  }

  return {
    contentRef,
    closeRef,
    onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return;
      const fromHandle = (event.target as HTMLElement).closest('[data-sheet-handle]') !== null;
      if (!fromHandle && scrolledAncestor(event.target)) return;
      gesture.current = { startY: touch.clientY, startAt: event.timeStamp, dy: 0, active: false };
    },
    onTouchMove(event: React.TouchEvent<HTMLDivElement>) {
      const state = gesture.current;
      const touch = event.touches[0];
      if (!state || !touch) return;
      const dy = touch.clientY - state.startY;
      // An upward start is a scroll of the list, not a drag of the sheet.
      if (!state.active && dy < 0) {
        gesture.current = null;
        return;
      }
      if (!state.active && dy < 6) return;
      state.active = true;
      state.dy = Math.max(0, dy);
      setOffset(state.dy, false);
    },
    onTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
      const state = gesture.current;
      gesture.current = null;
      if (!state?.active) return;
      const node = contentRef.current;
      const velocity = state.dy / Math.max(1, event.timeStamp - state.startAt);
      if (node && (state.dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY)) {
        setOffset(node.offsetHeight, true);
        window.setTimeout(() => {
          node.dataset.dragged = '';
          closeRef.current?.click();
        }, 180);
      } else {
        setOffset(0, true);
      }
    },
    onTouchCancel() {
      if (gesture.current?.active) setOffset(0, true);
      gesture.current = null;
    },
  };
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

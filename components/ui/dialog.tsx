"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // Phone: a sheet that rises from the bottom edge, where the thumb
          // already is, and scrolls inside itself when the form is long.
          // `sm` and up: the centred card the desk has always had.
          "fixed inset-x-0 bottom-0 z-50 grid max-h-[92svh] w-full gap-4 overflow-y-auto overscroll-contain rounded-t-3xl bg-popover px-5 pt-7 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none data-open:animate-in data-closed:animate-out max-sm:duration-250 max-sm:data-open:slide-in-from-bottom max-sm:data-closed:slide-out-to-bottom sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100svh-2rem)] sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-4 sm:shadow-none sm:duration-100 sm:data-open:fade-in-0 sm:data-open:zoom-in-95 sm:data-closed:fade-out-0 sm:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        <span
          aria-hidden
          className="absolute top-2.5 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/25 sm:hidden"
        />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3 rounded-full bg-muted/70 sm:top-2 sm:right-2 sm:rounded-lg sm:bg-transparent"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Full-width stacked buttons on a phone, primary on top; a right-aligned
        // row from `sm`. The bottom margin reaches through the sheet's
        // safe-area padding so the tint meets the screen edge.
        "-mx-5 -mb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col-reverse gap-2.5 border-t bg-muted/50 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:-mx-4 sm:-mb-4 sm:flex-row sm:justify-end sm:gap-2 sm:rounded-b-xl sm:p-4 max-sm:[&_[data-slot=button]]:h-12 max-sm:[&_[data-slot=button]]:rounded-xl max-sm:[&_[data-slot=button]]:text-[15px]",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "pr-10 font-heading text-lg leading-tight font-semibold tracking-tight sm:pr-0 sm:text-base sm:leading-none sm:font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

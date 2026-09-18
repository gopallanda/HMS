import { HospitalIcon } from 'lucide-react';

import { ThemeToggle } from '@/components/shell/theme-toggle';

/**
 * Shell for signed-out screens. No sidebar, no hospital branding -- which
 * hospital a person belongs to is not known until they authenticate.
 *
 * The ground is a very shallow teal wash rather than flat grey: it is the only
 * screen in the product with nothing on it, and a card on a plain field looks
 * like an unstyled form. Radial gradients, so there is no seam at any viewport
 * width, and both are tinted from --primary so the login page follows the
 * theme instead of pinning a literal colour.
 *
 * The appearance toggle sits here rather than on the login page because every
 * signed-out screen has the same problem: the preference lives in the user
 * menu, and there is no user yet. One control in the layout covers login,
 * signup, both password recovery screens and the forced change.
 *
 * On a phone there is no card: the form sits straight on the washed ground
 * under a small product mark, top-aligned, the way an app's sign-in screen
 * does -- a card vertically centred in a 800px-tall viewport leaves two bands
 * of nothing and puts the button under the keyboard.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-1 flex-col items-stretch justify-start bg-background px-5 pt-[calc(env(safe-area-inset-top)+5.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:items-center sm:justify-center sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_15%_-10%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent),radial-gradient(45rem_35rem_at_100%_110%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent)]"
      />
      <div className="absolute inset-x-5 top-[calc(env(safe-area-inset-top)+1.25rem)] z-10 flex items-center justify-between sm:inset-x-6 sm:top-6">
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <HospitalIcon className="size-5 stroke-[1.6]" aria-hidden />
          </span>
          <span className="text-sm leading-tight font-semibold tracking-tight">
            HMS
            <span className="block text-xs font-normal text-muted-foreground">
              Hospital management
            </span>
          </span>
        </span>
        <ThemeToggle />
      </div>
      <div className="relative mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}

/**
 * Shell for signed-out screens. No sidebar, no hospital branding -- which
 * hospital a person belongs to is not known until they authenticate.
 *
 * The ground is a very shallow teal wash rather than flat grey: it is the only
 * screen in the product with nothing on it, and a card on a plain field looks
 * like an unstyled form. Radial gradients, so there is no seam at any viewport
 * width, and both are tinted from --primary so the login page follows the
 * theme instead of pinning a literal colour.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-1 items-center justify-center bg-background p-0 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_15%_-10%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent),radial-gradient(45rem_35rem_at_100%_110%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent)]"
      />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}

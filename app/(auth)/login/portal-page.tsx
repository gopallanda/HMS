import { InfoIcon } from 'lucide-react';
import Link from 'next/link';

import { LoginForm } from './login-form';
import { PORTAL_CONFIG, PORTALS, type Portal } from '@/lib/auth/portals';
import { cn } from '@/lib/cn';

/**
 * Reasons requireSession() bounced someone back here. Each one has a different
 * fix, so each one gets its own sentence rather than a shared "access denied".
 */
const REASON_MESSAGE: Record<string, string> = {
  signed_out: 'Your session ended. Sign in again to continue.',
  no_membership:
    'You are signed in, but no hospital is attached to your account. Ask an administrator to add you.',
  hospital_missing:
    'Your account points at a hospital this login cannot read. Ask an administrator to check your membership.',
  // Set by the signup action when the project requires email confirmation, so
  // there was no session to create the hospital with. It is created on the
  // first sign-in instead -- nothing is lost, and the wording says so.
  check_email:
    'Check your email and confirm your address, then sign in here. Your hospital is set up on your first sign-in.',
  // /auth/confirm could not redeem the token: expired, already used, or edited.
  // All three need the same thing -- a fresh link -- so they share a sentence.
  link_invalid:
    'That link has expired or has already been used. Ask for a new one, or sign in below.',
  // Set after a password reset or a forced change. Saying so explicitly matters
  // here: the person has just typed a new password and being dropped back on a
  // login screen with no explanation reads as "it did not work".
  password_changed: 'Your password has been changed. Sign in with it.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * One sign-in door. /login, /login/doctor and /login/staff are this component
 * with a different `portal`; the card, the form and the action are shared, so
 * the three cannot drift apart.
 */
export async function PortalPage({
  portal,
  searchParams,
}: {
  portal: Portal;
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? REASON_MESSAGE[params.reason] : undefined;
  const next = typeof params.next === 'string' ? params.next : undefined;
  const config = PORTAL_CONFIG[portal];

  // The other two doors, carrying ?next= along so a deep link survives
  // somebody picking the right door second.
  const others = PORTALS.filter((entry) => entry !== portal).map((entry) => ({
    ...PORTAL_CONFIG[entry],
    href: next
      ? `${PORTAL_CONFIG[entry].href}?next=${encodeURIComponent(next)}`
      : PORTAL_CONFIG[entry].href,
  }));

  return (
    <div className="grid gap-8 sm:gap-5">
      {/* No card on a phone: the form sits on the layout's ground (see the
          auth layout). The card comes back at `sm`. */}
      <div className="w-full rounded-none border-0 bg-transparent p-0 shadow-none sm:rounded-2xl sm:border sm:border-border/60 sm:bg-card sm:p-8 sm:shadow-lg">
        <div className="mb-7 grid gap-3 sm:mb-6">
          <span
            className={cn(
              'justify-self-start rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.12em] uppercase',
              'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            {config.badge}
          </span>
          <div className="grid gap-1">
            <h1 className="text-[28px] leading-tight font-bold tracking-tight sm:text-2xl sm:font-semibold">
              {config.title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{config.subtitle}</p>
          </div>
        </div>

        <div className="grid gap-4">
          {reason ? (
            <p className="flex items-start gap-2 rounded-xl bg-muted px-3.5 py-3 text-xs text-muted-foreground sm:rounded-lg sm:px-3 sm:py-2.5">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{reason}</span>
            </p>
          ) : null}

          <LoginForm next={next} portal={portal} />
        </div>

        {portal === 'admin' ? (
          <p className="mt-6 border-t border-border/60 pt-4 text-sm text-muted-foreground">
            New here?{' '}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create a hospital
            </Link>
          </p>
        ) : null}
      </div>

      <nav aria-label="Other sign-in portals" className="grid gap-2.5 text-center">
        <p className="text-xs font-medium text-muted-foreground sm:hidden">Signing in somewhere else?</p>
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:justify-center sm:gap-6">
          {others.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="flex h-11 items-center justify-center rounded-xl border border-border bg-card/70 text-sm font-medium text-foreground backdrop-blur-sm transition active:scale-[0.98] sm:h-auto sm:border-0 sm:bg-transparent sm:font-normal sm:text-muted-foreground sm:underline-offset-4 sm:hover:text-foreground sm:hover:underline"
            >
              {entry.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

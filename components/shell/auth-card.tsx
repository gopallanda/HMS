import { HospitalIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * The one card every signed-out screen sits in.
 *
 * Sign-in, sign-up and set-password were three copies of the same header; a
 * single component means the mark, the title and the spacing cannot drift
 * apart, and a change to the sign-in screen is not a change to two others that
 * somebody forgets to make.
 *
 * On a phone it drops its shadow and rounding and fills the viewport, which
 * reads as an app screen rather than as a small card floating on a big empty
 * page. The shadow comes back at `sm`.
 */
export function AuthCard({
  title,
  subtitle,
  footer,
  className,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'w-full max-w-md rounded-none border-0 bg-card p-6 shadow-none sm:rounded-2xl sm:border sm:border-border/60 sm:p-8 sm:shadow-lg',
        className,
      )}
    >
      <div className="mb-6 grid gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <HospitalIcon className="size-5.5 stroke-[1.5]" />
        </span>
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>

      {children}

      {footer ? (
        <p className="mt-6 border-t border-border/60 pt-4 text-sm text-muted-foreground">
          {footer}
        </p>
      ) : null}
    </div>
  );
}

import { cn } from '@/lib/cn';

/**
 * A keyboard shortcut, printed as a key.
 *
 * The front desk, billing and pharmacy screens are meant to be driven without a
 * mouse (CLAUDE.md 7), which only helps if the shortcuts are discoverable --
 * staff learn them by seeing them on the screen they are already using, not
 * from a manual. Hidden below `lg` by default: on a phone there is no F2 to
 * press, and the hint is just noise taking counter space.
 */
export function Kbd({
  children,
  className,
  always = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Show on small screens too. For hints that describe an on-screen control. */
  always?: boolean;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] leading-none font-medium text-muted-foreground shadow-sm',
        always ? 'inline-flex' : 'hidden lg:inline-flex',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * A shortcut with its meaning: `[F2] Register`. Grouped in a row under a
 * search field or along the bottom of a desk screen.
 */
export function KbdHint({
  keys,
  children,
  className,
  always = false,
}: {
  keys: string | readonly string[];
  children: React.ReactNode;
  className?: string;
  always?: boolean;
}) {
  const list = typeof keys === 'string' ? [keys] : keys;

  return (
    <span
      className={cn(
        'items-center gap-1.5 text-xs text-muted-foreground',
        always ? 'inline-flex' : 'hidden lg:inline-flex',
        className,
      )}
    >
      {list.map((key) => (
        <Kbd key={key} always>
          {key}
        </Kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}

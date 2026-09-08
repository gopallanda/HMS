'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/cn';

/**
 * The appearance choice for screens that have no shell to hang it off.
 *
 * Signed in, this preference lives in the user menu, next to the person it
 * belongs to (components/shell/user-menu.tsx). The auth screens have no
 * sidebar and no user -- which hospital somebody belongs to is not known until
 * they authenticate -- so the only way to change the theme was to sign in
 * first. That is fine for a developer and wrong for a front desk machine whose
 * Windows install is dark and whose day shift is not.
 *
 * Same store, deliberately: next-themes writes localStorage under one key, so
 * a choice made here IS the choice the user menu shows afterwards, on that
 * browser, and nobody has to make it twice.
 *
 * A segmented control rather than a dropdown, because there is no menu here to
 * put it in and a bare icon that cycles through three states gives no way to
 * tell 'system, currently dark' from 'dark'.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  // `theme` reads localStorage, which the server cannot know, so the first
  // client render must match the server's or React replays the whole tree as
  // a hydration error. Rendering the same unselected control on both passes
  // costs one frame and keeps the size identical, so nothing moves when the
  // choice resolves.
  //
  // useSyncExternalStore rather than the usual setState-in-an-effect: it is
  // the same trick expressed as what it actually is -- a value the server and
  // the client disagree about -- and React reads the two snapshots itself
  // instead of being made to render twice.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border bg-card/70 p-0.5 backdrop-blur-sm',
        className,
      )}
      role="radiogroup"
      aria-label="Appearance"
    >
      {THEMES.map((option) => {
        const active = mounted && (theme ?? 'system') === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={cn(
              'flex size-7 items-center justify-center rounded-full outline-none transition-colors',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <option.icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Nothing to subscribe to: the snapshots alone carry server vs client. */
function subscribeToNothing() {
  return () => {};
}

const THEMES = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const;

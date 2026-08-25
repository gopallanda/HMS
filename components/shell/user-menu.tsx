'use client';

import { ChevronDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRef } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/auth/actions';
import { roleLabel, type AppRole } from '@/lib/roles';

/**
 * Who is signed in, and the way out.
 *
 * The role is shown, not hidden in a settings page: on a shared front-desk
 * machine "am I still logged in as the night cashier" is a question people ask
 * several times a shift, and getting it wrong misattributes collected_by on
 * every payment they take (CLAUDE.md 3.2).
 */
export function UserMenu({
  name,
  email,
  role,
  showLabels = true,
}: {
  name: string | null;
  email: string | null;
  role: AppRole;
  /** False in the tablet icon rail, where only the avatar fits. */
  showLabels?: boolean;
}) {
  // A plain form so sign-out is a real POST to the Server Action, with the
  // menu item merely pressing the button.
  const signOutForm = useRef<HTMLFormElement>(null);

  const label = name ?? email ?? 'Signed in';

  return (
    <>
      <form ref={signOutForm} action={signOut} className="hidden" />

      <DropdownMenu>
        <DropdownMenuTrigger
          className={
            showLabels
              ? 'flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-sidebar-border hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
              : 'grid w-full place-items-center rounded-lg px-1 py-2 transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
          }
          title={showLabels ? undefined : `${label} — ${roleLabel(role)}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {label.slice(0, 2).toUpperCase()}
          </span>
          {showLabels ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{label}</span>
                {/* The role reads as a badge, not as a second line of the name:
                    on a shared machine it is the fact people actually check. */}
                <span className="mt-0.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-primary uppercase">
                  {roleLabel(role)}
                </span>
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          ) : null}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="truncate text-xs font-medium">{label}</span>
            {email ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {email}
              </span>
            ) : null}
            <span className="text-xs font-normal text-muted-foreground">
              Signed in as {roleLabel(role)}
            </span>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <ThemeChoice />

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>
            <LogOutIcon data-icon="inline-start" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const THEMES = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const;

/**
 * Light / dark / system.
 *
 * It lives in this menu rather than in hospital settings because it is a
 * preference of the PERSON, not of the hospital -- the night shift on the same
 * front-desk machine wants a different answer from the day shift, and neither
 * should be writing to the hospitals row to get it.
 *
 * `theme` is undefined until next-themes has read localStorage, which happens
 * on mount. That is not a hydration risk here: Radix only mounts this menu's
 * content when it is opened, which is always after hydration.
 */
function ThemeChoice() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        Appearance
      </DropdownMenuLabel>
      {THEMES.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          <option.icon data-icon="inline-start" />
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

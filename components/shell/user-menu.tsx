'use client';

import { ChevronDownIcon, LogOutIcon } from 'lucide-react';
import { useRef } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
}: {
  name: string | null;
  email: string | null;
  role: AppRole;
}) {
  // A plain form so sign-out is a real POST to the Server Action, with the
  // menu item merely pressing the button.
  const signOutForm = useRef<HTMLFormElement>(null);

  const label = name ?? email ?? 'Signed in';

  return (
    <>
      <form ref={signOutForm} action={signOut} className="hidden" />

      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-semibold text-sidebar-accent-foreground">
            {label.slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden min-w-0 flex-1 md:block">
            <span className="block truncate text-xs font-medium">{label}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {roleLabel(role)}
            </span>
          </span>
          <ChevronDownIcon className="hidden size-3.5 shrink-0 text-muted-foreground md:block" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="truncate text-xs font-medium">{label}</span>
            {email ? (
              <span className="truncate text-[11px] font-normal text-muted-foreground">
                {email}
              </span>
            ) : null}
            <span className="text-[11px] font-normal text-muted-foreground">
              Signed in as {roleLabel(role)}
            </span>
          </DropdownMenuLabel>

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

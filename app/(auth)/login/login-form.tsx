'use client';

import { IdCardIcon, MailIcon } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';

import { signIn } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';
import { cn } from '@/lib/cn';

/**
 * Which kind of identifier the person in front of the screen holds.
 *
 * NOT a role, and deliberately not one. Doctor, nurse, cashier and cleaner all
 * sign in the same way, through the same shell, and what they may open comes
 * from their permissions once they are in (CLAUDE.md 3.6) -- a "doctor login"
 * tab would promise an isolation that does not exist and could not be enforced
 * from a tab anyway.
 *
 * What genuinely differs is what somebody was HANDED. Staff got a username on a
 * slip of paper at the desk. Whoever created the hospital through /signup has
 * only ever had their own mailbox, because at that moment there was no staff
 * record to build a username from. One field could not say both without the
 * founder reading "The name on the slip your administrator gave you" and
 * concluding this screen is not for them.
 *
 * The switch is presentation. `signIn` still decides by the presence of an '@',
 * so an owner who leaves it on Staff and types an email still gets in.
 */
type Mode = 'staff' | 'owner';

const MODES: {
  value: Mode;
  label: string;
  icon: typeof IdCardIcon;
  field: { label: string; placeholder: string; hint: string; autoComplete: string };
}[] = [
  {
    value: 'staff',
    label: 'Staff',
    icon: IdCardIcon,
    field: {
      label: 'Username',
      placeholder: 'pavan.kumar',
      hint: 'The name on the slip your administrator gave you.',
      autoComplete: 'username',
    },
  },
  {
    value: 'owner',
    label: 'Owner',
    icon: MailIcon,
    field: {
      label: 'Email address',
      placeholder: 'you@example.com',
      hint: 'The address you created the hospital with.',
      autoComplete: 'email',
    },
  },
];

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signIn, IDLE);
  const [mode, setMode] = useState<Mode>('staff');
  /**
   * Controlled only so the value survives the remount below. An uncontrolled
   * input keyed on the mode is a new input, and a new input starts empty.
   */
  const [identifier, setIdentifier] = useState('');
  const identifierInput = useRef<HTMLInputElement>(null);

  const active = MODES.find((entry) => entry.value === mode) ?? MODES[0];
  const error = fieldError(state, 'identifier');

  /**
   * Switching keeps whatever has been typed. Somebody who starts on the wrong
   * tab has usually already typed the whole thing, and clearing it would make
   * the switch cost more than the mislabelling did.
   */
  function switchTo(value: Mode) {
    setMode(value);
    identifierInput.current?.focus();
  }

  return (
    <form action={formAction} className="grid gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FormMessage state={state} />

      {/* Two entry modes for one field, so the box around them is what says
          they are alternatives rather than steps. */}
      <div
        role="radiogroup"
        aria-label="How you sign in"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        {MODES.map((entry) => {
          const Icon = entry.icon;
          const selected = entry.value === mode;
          return (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => switchTo(entry.value)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {entry.label}
            </button>
          );
        })}
      </div>

      <Field
        label={active.field.label}
        htmlFor="identifier"
        error={error}
        hint={active.field.hint}
        required
      >
        <Input
          // Remounted on a switch, so the browser re-reads type and
          // autocomplete instead of keeping the ones it saw first -- an
          // autofill dropdown offering usernames on an email field is the
          // whole reason this switch is worth having.
          key={mode}
          ref={identifierInput}
          id="identifier"
          name="identifier"
          type={mode === 'owner' ? 'email' : 'text'}
          inputMode={mode === 'owner' ? 'email' : 'text'}
          autoComplete={active.field.autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder={active.field.placeholder}
          aria-invalid={error !== undefined}
          required
          // Focus lands here on load: this screen is the first keystroke of
          // every shift (CLAUDE.md 7).
          autoFocus
        />
      </Field>

      <Field label="Password" htmlFor="password" error={fieldError(state, 'password')} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={fieldError(state, 'password') !== undefined}
          required
        />
      </Field>

      <SubmitButton className="mt-2 w-full" size="lg" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>

      <Link
        href="/forgot-password"
        className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Forgotten your password?
      </Link>
    </form>
  );
}

'use client';

import { IdCardIcon, MailIcon } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';

import { signIn } from './actions';
import { PORTAL_CONFIG, type Portal } from '@/lib/auth/portals';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE } from '@/lib/action-state';
import { cn } from '@/lib/cn';

/**
 * Which kind of identifier the person in front of the screen holds.
 *
 * NOT a role. Which door somebody uses (admin, doctor, staff) is the portal,
 * a separate page, checked by the action once the password is right -- see
 * lib/auth/portals.ts. What they may open still comes from their permissions
 * once they are in (CLAUDE.md 3.6). This switch appears on the admin door only.
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
  field: {
    label: string;
    placeholder: string;
    hint: string;
    autoComplete: string;
  };
}[] = [
  {
    value: 'staff',
    label: 'Username',
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
    label: 'Email',
    icon: MailIcon,
    field: {
      label: 'Email address',
      placeholder: 'you@example.com',
      hint: 'The address you created the hospital with.',
      autoComplete: 'email',
    },
  },
];

export function LoginForm({ next, portal }: { next?: string; portal: Portal }) {
  const [state, formAction] = useActionState(signIn, IDLE);
  // Only the admin door has a founder behind it, so only it offers the email
  // switch. Doctors and staff were all handed a username at the desk.
  const allowsEmail = PORTAL_CONFIG[portal].allowsEmail;
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
      <input type="hidden" name="portal" value={portal} />

      <FormMessage state={state} />

      {/* Two entry modes for one field, so the box around them is what says
          they are alternatives rather than steps. */}
      {allowsEmail ? (
        <div
          role="radiogroup"
          aria-label="How you sign in"
          className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 md:rounded-lg"
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
                  'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:rounded-md md:py-1.5',
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
      ) : null}

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

      <Link
        href="/forgot-password"
        className="-mt-2 justify-self-end py-1 text-sm font-medium text-primary underline-offset-4 hover:underline md:py-0 md:text-xs md:font-normal md:text-muted-foreground"
      >
        Forgot password?
      </Link>

      <SubmitButton className="mt-1 w-full" size="lg" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  );
}

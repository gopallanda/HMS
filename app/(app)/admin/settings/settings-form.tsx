'use client';

import { ImageIcon, ImageUpIcon, Trash2Icon } from 'lucide-react';
import { useActionState, useState } from 'react';

import { removeHospitalLogo, saveHospitalSettings } from './actions';
import { Field } from '@/components/shared/field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { HospitalMark } from '@/components/shell/hospital-mark';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fieldError, IDLE } from '@/lib/action-state';
import type { Hospital } from '@/lib/auth/session';
import {
  defaultPrintFormat,
  PRINT_FORMATS,
  PRINT_FORMAT_LABEL,
  PRINT_FORMAT_NOTE,
  type PrintFormat,
} from '@/lib/billing';
import { cn } from '@/lib/cn';
import { checkLogoFile, LOGO_ACCEPT } from '@/lib/schemas/hospital';

const FORM_ID = 'hospital-settings';

export function SettingsForm({ hospital }: { hospital: Hospital }) {
  const [state, save] = useActionState(saveHospitalSettings, IDLE);
  const [removeState, remove] = useActionState(removeHospitalLogo, IDLE);

  // Local preview and local rejection, so a 2.5 MB photo is refused before it
  // travels rather than after. The Server Action checks again -- this is
  // convenience, not validation.
  const [preview, setPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [receiptDefault, setReceiptDefault] = useState<PrintFormat>(() =>
    defaultPrintFormat(hospital.settings),
  );

  function onPickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setLogoError(null);
    if (!file) return;

    const check = checkLogoFile(file);
    if (!check.ok) {
      setLogoError(check.message);
      event.target.value = '';
      return;
    }
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Hospital
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            These fields print at the top of every invoice, receipt and prescription.
          </p>
        </CardHeader>
        <CardContent>
          <form id={FORM_ID} action={save} className="grid gap-5">
            <FormMessage state={state} />

            <Field label="Name" htmlFor="name" error={fieldError(state, 'name')} required>
              <Input
                id="name"
                name="name"
                defaultValue={hospital.name}
                maxLength={120}
                required
                autoFocus
                aria-invalid={fieldError(state, 'name') !== undefined}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Phone" htmlFor="phone" error={fieldError(state, 'phone')}>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={hospital.phone ?? ''}
                  placeholder="+91 80 4123 5566"
                  aria-invalid={fieldError(state, 'phone') !== undefined}
                />
              </Field>

              <Field
                label="GSTIN"
                htmlFor="gstin"
                error={fieldError(state, 'gstin')}
                hint="15 characters, e.g. 29ABCDE1234F1Z5. Hospital services are largely GST exempt."
              >
                <Input
                  id="gstin"
                  name="gstin"
                  defaultValue={hospital.gstin ?? ''}
                  maxLength={15}
                  placeholder="29ABCDE1234F1Z5"
                  className="uppercase"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={fieldError(state, 'gstin') !== undefined}
                />
              </Field>
            </div>

            <Field label="Address" htmlFor="address" error={fieldError(state, 'address')}>
              <Textarea
                id="address"
                name="address"
                rows={3}
                maxLength={300}
                defaultValue={hospital.address ?? ''}
                placeholder="14 MG Road, Indiranagar, Bengaluru 560038"
                aria-invalid={fieldError(state, 'address') !== undefined}
              />
            </Field>

            {/* ---- Printing (block 5) ---------------------------------------
                Which paper the counter is loaded with. It is a fact about the
                hardware in the room, so it belongs to the hospital rather than
                to the person, and it is the default every receipt route opens
                with. */}
            <fieldset className="grid gap-2 border-t border-border/60 pt-4">
              <legend className="sr-only">Printing</legend>
              <p className="text-sm font-medium">Printing</p>
              <p className="text-xs text-muted-foreground">
                The paper a receipt opens on. Either can still be chosen on the receipt
                itself.
              </p>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {PRINT_FORMATS.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      'grid cursor-pointer gap-0.5 rounded-xl border px-3.5 py-3 transition has-focus-visible:ring-3 has-focus-visible:ring-ring/50 active:scale-[0.99] sm:rounded-lg sm:px-3 sm:py-2.5',
                      receiptDefault === option
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center gap-2.5 sm:gap-2">
                      {/* The native radio still posts receipt_default; the
                          drawn circle is what people see. */}
                      <input
                        type="radio"
                        name="receipt_default"
                        value={option}
                        checked={receiptDefault === option}
                        onChange={() => setReceiptDefault(option)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors sm:size-3.5 sm:border-[1.5px]',
                          receiptDefault === option ? 'border-primary' : 'border-input',
                        )}
                      >
                        {receiptDefault === option ? (
                          <span className="size-2 rounded-full bg-primary sm:size-1.5" />
                        ) : null}
                      </span>
                      <span className="text-sm font-medium">{PRINT_FORMAT_LABEL[option]}</span>
                    </span>
                    <span className="pl-7 text-xs text-muted-foreground sm:pl-5.5">
                      {PRINT_FORMAT_NOTE[option]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
              <SubmitButton pendingLabel="Saving..." className="max-sm:w-full">
                Save changes
              </SubmitButton>
              <span className="text-xs text-muted-foreground">
                Saves the logo selected alongside too.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* First on a phone: the logo is saved by the Save button in the other
          card, so picking it before scrolling down to that button is the order
          that works. Beside the form from `lg`. */}
      <Card className="order-first h-fit lg:order-none">
        <CardHeader>
          <CardTitle className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Logo
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-3">
            {preview ? (
              // A local blob URL. next/image cannot optimise one, and would
              // only add a loader between the file picker and the preview.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Selected logo"
                className="size-12 rounded-lg bg-white object-contain"
              />
            ) : (
              <HospitalMark name={hospital.name} logoUrl={hospital.logo_url} size={48} />
            )}
            <div className="min-w-0 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {preview ? 'Not saved yet' : hospital.logo_url ? 'Current logo' : 'No logo yet'}
              </p>
              <p>PNG, JPEG, WebP or SVG. 2 MB max.</p>
            </div>
          </div>

          {/* Outside the form element, but posted with it via form=, so one
              Save covers the text fields and the logo together. */}
          {/* The native file input stays for the form post and the OS picker;
              the label drawn over it is the control people press. */}
          <Input
            id="logo"
            name="logo"
            form={FORM_ID}
            type="file"
            accept={LOGO_ACCEPT}
            onChange={onPickLogo}
            className="peer sr-only"
          />
          <label
            htmlFor="logo"
            className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-input bg-background text-sm font-medium transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:bg-muted active:scale-[0.99] md:h-9 md:rounded-lg"
          >
            <ImageUpIcon className="size-4" aria-hidden />
            {preview ? 'Choose a different logo' : 'Choose a logo'}
          </label>

          {logoError ? <p className="text-xs font-medium text-destructive">{logoError}</p> : null}
          {fieldError(state, 'logo') ? (
            <p className="text-xs font-medium text-destructive">{fieldError(state, 'logo')}</p>
          ) : null}

          <FormMessage state={removeState} />

          {hospital.logo_url ? (
            <form action={remove}>
              <SubmitButton variant="outline" pendingLabel="Removing...">
                <Trash2Icon data-icon="inline-start" />
                Remove logo
              </SubmitButton>
            </form>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ImageIcon className="size-3.5" />
              Printed documents show the hospital name until a logo is uploaded.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { FREQUENCY_SUGGESTIONS, type PrescriptionLine } from '@/lib/consultations';

/** A row while it is being typed. Every field is a string, including empty. */
type DraftLine = {
  key: string;
  drug: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  notes: string;
};

function blank(): DraftLine {
  return {
    key: crypto.randomUUID(),
    drug: '',
    strength: '',
    dose: '',
    frequency: '',
    duration: '',
    notes: '',
  };
}

function fromSaved(line: PrescriptionLine): DraftLine {
  return {
    key: crypto.randomUUID(),
    drug: line.drug,
    strength: line.strength ?? '',
    dose: line.dose ?? '',
    frequency: line.frequency ?? '',
    duration: line.duration ?? '',
    notes: line.notes ?? '',
  };
}

const MAX_LINES = 20;

/**
 * The prescription, as a repeatable row editor.
 *
 * For OPD this is the deliverable -- the patient walks out holding it. Kept
 * deliberately small (item 7): free text in every field, no drug master, no
 * stock, no dispensing. Those are Phase 2, and a half-built version of them
 * here would be something staff started using and then had to be migrated off.
 *
 * The list travels as ONE JSON string in a hidden field, the way the bill lines
 * do on the collect desk: a list of a list does not fit flat FormData, and this
 * keeps the enclosing form a plain <form action={...}> with no fetch in it.
 *
 * Rows with no drug name are dropped before the field is serialised. That is
 * the ONLY thing that is dropped silently, and it is safe because such a row is
 * an empty row somebody tabbed through; a row with a drug on it always
 * survives, and the schema refuses the list rather than trimming it if one ever
 * arrives malformed.
 */
export function PrescriptionEditor({
  initial,
  readOnly,
}: {
  initial: PrescriptionLine[];
  readOnly: boolean;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial.length > 0 ? initial.map(fromSaved) : [blank()],
  );

  const payload = useMemo(
    () =>
      JSON.stringify(
        lines
          .filter((line) => line.drug.trim() !== '')
          .map((line) => ({
            drug: line.drug.trim(),
            strength: line.strength.trim(),
            dose: line.dose.trim(),
            frequency: line.frequency.trim(),
            duration: line.duration.trim(),
            notes: line.notes.trim(),
          })),
      ),
    [lines],
  );

  const written = lines.filter((line) => line.drug.trim() !== '').length;

  function update(key: string, field: keyof Omit<DraftLine, 'key'>, value: string) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    );
  }

  function addLine() {
    setLines((current) => (current.length >= MAX_LINES ? current : [...current, blank()]));
  }

  function removeLine(key: string) {
    setLines((current) => {
      const next = current.filter((line) => line.key !== key);
      // Never leave the editor with nothing in it: an empty card reads as a
      // feature that is switched off rather than as a blank prescription.
      return next.length === 0 ? [blank()] : next;
    });
  }

  return (
    <div className="grid gap-2">
      {/* The one field that actually posts. Always present, even when empty:
          save_consultation replaces the list only when the key arrives, and a
          doctor who deleted every line means an empty prescription, not
          "leave the old one". */}
      <input type="hidden" name="prescription" value={payload} />

      <div className="grid gap-2">
        {lines.map((line, index) => (
          <div
            key={line.key}
            className={cn(
              'grid gap-2 rounded-lg border border-border/60 p-2.5',
              'sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]',
            )}
          >
            <Field
              label="Drug"
              value={line.drug}
              onChange={(value) => update(line.key, 'drug', value)}
              placeholder="Paracetamol"
              disabled={readOnly}
              maxLength={120}
              showLabel={index === 0}
              autoFocusable
            />
            <Field
              label="Strength"
              value={line.strength}
              onChange={(value) => update(line.key, 'strength', value)}
              placeholder="650 mg"
              disabled={readOnly}
              maxLength={60}
              showLabel={index === 0}
            />
            <Field
              label="Dose"
              value={line.dose}
              onChange={(value) => update(line.key, 'dose', value)}
              placeholder="1 tab"
              disabled={readOnly}
              maxLength={60}
              showLabel={index === 0}
            />
            <Field
              label="Frequency"
              value={line.frequency}
              onChange={(value) => update(line.key, 'frequency', value)}
              placeholder="TDS"
              disabled={readOnly}
              maxLength={60}
              showLabel={index === 0}
              list="prescription-frequencies"
            />
            <Field
              label="Duration"
              value={line.duration}
              onChange={(value) => update(line.key, 'duration', value)}
              placeholder="3 days"
              disabled={readOnly}
              maxLength={60}
              showLabel={index === 0}
            />

            <div className={cn('flex items-end', index === 0 && 'sm:pt-5.5')}>
              {readOnly ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Remove this line"
                  onClick={() => removeLine(line.key)}
                >
                  <Trash2Icon className="text-destructive" />
                  <span className="sr-only">Remove line {index + 1}</span>
                </Button>
              )}
            </div>

            <div className="sm:col-span-6">
              <Field
                label="Instructions"
                value={line.notes}
                onChange={(value) => update(line.key, 'notes', value)}
                placeholder="After food. Stop if rash appears."
                disabled={readOnly}
                maxLength={200}
                showLabel={index === 0}
              />
            </div>
          </div>
        ))}
      </div>

      {/* The abbreviations an Indian OPD writes, offered as suggestions rather
          than as a select: a doctor who wants "1-0-1" must still be able to
          type it. */}
      <datalist id="prescription-frequencies">
        {FREQUENCY_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
            disabled={lines.length >= MAX_LINES}
          >
            <PlusIcon data-icon="inline-start" />
            Add drug
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {written === 0
            ? 'No drugs written. A line needs a drug name; everything else is optional.'
            : `${written} drug${written === 1 ? '' : 's'} on this prescription. Empty rows are ignored.`}
        </p>
      </div>
    </div>
  );
}

/**
 * One cell. The label prints only on the first row: six labels repeated down a
 * five-drug script is noise on a screen a doctor reads at speed, and the
 * placeholder carries the meaning on every row after it.
 */
function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  showLabel,
  list,
  autoFocusable,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  maxLength: number;
  showLabel: boolean;
  list?: string;
  autoFocusable?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span
        className={cn(
          'text-xs font-medium text-muted-foreground',
          showLabel ? 'block' : 'sr-only',
        )}
      >
        {label}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        list={list}
        autoComplete="off"
        // The drug field is what a doctor tabs into; the rest follow in DOM
        // order, which is the order they are written in.
        data-prescription-first={autoFocusable ? '' : undefined}
        className="h-9 md:h-9"
      />
    </label>
  );
}

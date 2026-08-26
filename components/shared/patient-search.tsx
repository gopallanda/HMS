'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import { ageGender } from '@/lib/patients';
import { searchPatients, type PatientSearchResult } from '@/lib/rpc/patients';
import { createClient } from '@/lib/supabase/client';
import { formatDate } from '@/lib/utils/dates';

/**
 * The one patient search in the app.
 *
 * Registration and the patient record ask the same question of the same RPC,
 * and the two screens have to agree about what "3 characters" and "150ms" mean
 * -- otherwise the desk learns one set of reflexes and the record screen
 * rewards a different one (CLAUDE.md 6 lists PatientSearch as shared).
 *
 * Deliberately only the hook and the result row. The register desk's dialogs,
 * its duplicate-phone handling and its visit creation stay where they are: that
 * screen is the most-used one in the building and a wider refactor buys nothing
 * a duplicated hook would have cost.
 */

/**
 * Shorter than this and the trigram indexes cannot be used, so search_patients
 * returns nothing on purpose rather than scanning the table on every keystroke.
 */
export const MIN_QUERY = 3;

/** Long enough to swallow a fast typist's next keystroke, short enough to feel live. */
export const DEBOUNCE_MS = 150;

/** The shared search hook: same query key everywhere, so the cache is shared. */
export function usePatientSearch(query: string, enabled = true) {
  const supabase = useMemo(() => createClient(), []);
  const [debounced, setDebounced] = useState(query.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const active = enabled && debounced.length >= MIN_QUERY;

  const result = useQuery({
    queryKey: ['patient-search', debounced],
    enabled: active,
    // Keeps the previous list on screen while the next one loads, so the
    // results do not blink out from under a finger already moving to Enter.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await searchPatients(supabase, debounced);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  return { ...result, debounced, active };
}

/**
 * One match, as a row in a listbox.
 *
 * Rendering only -- the caller owns the keyboard cursor and decides what
 * picking a row means (start a visit, open the record). Both screens show the
 * same four facts in the same places, so an operator who has learned to scan
 * for the MRN column at the desk finds it in the same place on the record
 * screen.
 */
export function PatientResultRow({
  patient,
  index,
  selected,
  onHover,
  onPick,
}: {
  patient: PatientSearchResult;
  index: number;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <div
      data-index={index}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2.5 text-sm transition-colors last:border-0 sm:px-4',
        selected ? 'bg-primary/10' : 'hover:bg-muted/60',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">{patient.full_name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {ageGender(patient.dob, patient.gender)}
          </span>
        </span>
        {/* Below `sm` the columns collapse into one line of metadata under the
            name: a 360px screen has room for who this is, not for a table. */}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground sm:hidden">
          <span className="font-mono">{patient.mrn}</span>
          {patient.phone ? <span className="font-mono">{patient.phone}</span> : null}
        </span>
      </span>

      <span className="hidden w-40 shrink-0 font-mono text-xs text-muted-foreground sm:block">
        {patient.mrn}
      </span>
      <span className="hidden w-36 shrink-0 font-mono text-xs sm:block">
        {patient.phone ?? '-'}
      </span>
      <span className="hidden w-44 shrink-0 text-right text-xs text-muted-foreground lg:block">
        {patient.last_visit_at
          ? `${patient.visit_count} visit${patient.visit_count === 1 ? '' : 's'} \u00b7 last ${formatDate(patient.last_visit_at)}`
          : 'No visits yet'}
      </span>
    </div>
  );
}

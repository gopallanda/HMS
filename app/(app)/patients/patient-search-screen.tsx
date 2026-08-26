'use client';

import { SearchIcon, UserRoundPlusIcon, UserRoundSearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/shared/empty-state';
import { Kbd, KbdHint } from '@/components/shared/kbd';
import {
  MIN_QUERY,
  PatientResultRow,
  usePatientSearch,
} from '@/components/shared/patient-search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Find a patient, open their record.
 *
 * The same search box the register desk opens with -- same RPC, same three
 * characters, same debounce, same row -- because it is the same question. What
 * differs is what Enter does: here it opens the record, there it starts a
 * visit.
 */
export function PatientSearchScreen({ canRegister }: { canRegister: boolean }) {
  const router = useRouter();

  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isFetching, error, active, debounced } = usePatientSearch(query);
  const results = useMemo(() => data ?? [], [data]);

  const [highlight, setHighlight] = useState(0);
  const [highlightFor, setHighlightFor] = useState('');

  if (highlightFor !== debounced) {
    // Adjusted during render rather than in an effect: a new set of results
    // starts at the top, and React re-renders before anything reaches the DOM.
    setHighlightFor(debounced);
    setHighlight(0);
  }

  /** Highlighted row, clamped -- the list can shrink under a held arrow key. */
  const cursor = results.length === 0 ? -1 : Math.min(highlight, results.length - 1);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Prefetching on highlight, not on click: by the time a finger reaches Enter
  // the record is usually already in the router cache.
  useEffect(() => {
    const picked = cursor >= 0 ? results[cursor] : undefined;
    if (picked) router.prefetch(`/patients/${picked.id}`);
  }, [cursor, results, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function open(id: string) {
    router.push(`/patients/${id}`);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = cursor >= 0 ? results[cursor] : undefined;
      if (picked) open(picked.id);
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      setQuery('');
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute inset-y-0 left-4 my-auto size-4.5 text-muted-foreground" />
          <Input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Phone, name or MRN"
            className="h-12 rounded-xl border-transparent bg-muted/60 pr-12 pl-12 text-base shadow-none transition-all focus-visible:border-primary focus-visible:bg-background focus-visible:shadow-md md:h-12 md:text-base"
            aria-label="Search patients"
            aria-controls="patient-results"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 hidden items-center lg:flex">
            <Kbd always>/</Kbd>
          </span>
        </div>

        {canRegister ? (
          <Button asChild variant="outline" className="h-12 shrink-0 rounded-xl md:h-12">
            <Link href="/front-desk/register">
              <UserRoundPlusIcon data-icon="inline-start" />
              Register a patient
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {!active
            ? `Type ${MIN_QUERY} characters or more`
            : isFetching
              ? 'Searching...'
              : `${results.length} match${results.length === 1 ? '' : 'es'}`}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <KbdHint keys={['\u2191', '\u2193']}>move</KbdHint>
          <KbdHint keys="Enter">open record</KbdHint>
          <KbdHint keys="Esc">clear</KbdHint>
        </span>
      </div>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          Search failed: {error.message}
        </p>
      ) : null}

      <div
        ref={listRef}
        id="patient-results"
        role="listbox"
        aria-label="Matching patients"
        className="custom-scrollbar max-h-[32rem] overflow-y-auto rounded-xl border border-border/60 bg-card shadow-sm"
      >
        {!active ? (
          <EmptyState
            icon={UserRoundSearchIcon}
            title="Search for a patient"
            description="Their record carries every visit, every bill and -- for clinical staff -- every consultation note."
          />
        ) : results.length === 0 && !isFetching ? (
          <EmptyState
            icon={UserRoundSearchIcon}
            title={`Nobody matches \u201c${query.trim()}\u201d`}
            description={
              canRegister
                ? 'Check the spelling, or try the phone number. If they really are new, register them at the desk.'
                : 'Check the spelling, or try the phone number. The front desk can register them if they are new.'
            }
            action={
              canRegister ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/front-desk/register">Register a patient</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          results.map((patient, index) => (
            <PatientResultRow
              key={patient.id}
              patient={patient}
              index={index}
              selected={index === cursor}
              onHover={() => setHighlight(index)}
              onPick={() => open(patient.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

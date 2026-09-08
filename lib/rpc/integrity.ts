/**
 * The cash integrity report.
 *
 * Like the other files in this directory this takes the Supabase client as an
 * argument rather than creating one, so the same wrapper serves a Server
 * Component read and a Server Action.
 *
 * The RPC returns one flat table with a `bucket` discriminator -- the shape
 * day_close_report uses -- so the screen makes a single round trip and the
 * league table and the event list are guaranteed to describe the same moment.
 * This module splits it back apart.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

export type IntegrityRow =
  Database['public']['Functions']['cash_integrity_report']['Returns'][number];

/**
 * The five things this report counts.
 *
 * Ordered by how much explaining each one needs from the person who did it,
 * which is the order the summary table shows them in. A reprint is usually a
 * jammed roll; a void on a closed day almost never is.
 */
export const INTEGRITY_KINDS = [
  'void',
  'reversal',
  'discount',
  'deferral',
  'reprint',
] as const;

export type IntegrityKind = (typeof INTEGRITY_KINDS)[number];

export const INTEGRITY_LABEL: Record<IntegrityKind, string> = {
  void: 'Voided',
  reversal: 'Reversed',
  discount: 'Concessions',
  deferral: 'Deferred',
  reprint: 'Reprints',
};

/**
 * What the amount column MEANS for each kind, in the header of the detail
 * list. They are five different quantities and a single "Amount" heading over
 * all of them would invite somebody to total the column, which would be
 * meaningless: a reprint's amount is the bill that was printed again, not
 * money that moved.
 */
export const INTEGRITY_AMOUNT_LABEL: Record<IntegrityKind, string> = {
  void: 'Bill retired',
  reversal: 'Payment undone',
  discount: 'Given away',
  deferral: 'Let through',
  reprint: 'Bill reprinted',
};

/** One line of the explanation shown under each summary column. */
export const INTEGRITY_DESCRIPTION: Record<IntegrityKind, string> = {
  void: 'A bill retired after it was raised. The number stays consumed.',
  reversal: 'A payment undone. The refund happens at the counter, not here.',
  discount: 'A concession given at the counter, with a reason.',
  deferral: 'A patient seen before paying, with an approval.',
  reprint: 'The second copy of a receipt onwards. The first is not counted.',
};

export type IntegritySummary = {
  kind: IntegrityKind;
  actorId: string | null;
  actorName: string;
  count: number;
  amount: number;
  afterCloseCount: number;
};

export type IntegrityEvent = {
  id: string;
  kind: IntegrityKind;
  actorId: string | null;
  actorName: string;
  at: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  patientName: string | null;
  amount: number;
  reason: string | null;
  detail: string | null;
  afterClose: boolean;
};

/** One row of the per-person league table: a name, and a cell per kind. */
export type IntegrityPerson = {
  actorId: string | null;
  actorName: string;
  byKind: Record<IntegrityKind, { count: number; amount: number; afterClose: number }>;
  /** Total events, which is what the table is ranked on. */
  total: number;
  /** Total events that landed on a day already closed. */
  afterClose: number;
};

/**
 * Voids, reversals, reprints, concessions and deferrals over an IST date
 * range, with a per-person summary counted over the whole range.
 *
 * hospital_id is sent so the read is explicit about its tenant; the function
 * reads it from the JWT anyway and refuses a payload that disagrees.
 */
export async function cashIntegrityReport(
  supabase: Client,
  hospitalId: string,
  from: string,
  to: string,
  limit = 500,
) {
  return supabase.rpc('cash_integrity_report', {
    p_hospital_id: hospitalId,
    p_from: from,
    p_to: to,
    p_limit: limit,
  });
}

function isKind(value: string | null): value is IntegrityKind {
  return INTEGRITY_KINDS.includes(value as IntegrityKind);
}

function emptyByKind(): IntegrityPerson['byKind'] {
  return {
    void: { count: 0, amount: 0, afterClose: 0 },
    reversal: { count: 0, amount: 0, afterClose: 0 },
    discount: { count: 0, amount: 0, afterClose: 0 },
    deferral: { count: 0, amount: 0, afterClose: 0 },
    reprint: { count: 0, amount: 0, afterClose: 0 },
  };
}

/**
 * Splits the flat result into the two things the screen shows.
 *
 * A row whose `kind` is not one this build knows about is dropped, for the
 * same reason toPermissionSet() drops an unknown permission key: the database
 * is not the authority on what the code can render, and a stray kind would
 * otherwise appear as an unlabelled column nobody can act on.
 */
export function groupIntegrity(rows: IntegrityRow[]) {
  const summary: IntegritySummary[] = [];
  const events: IntegrityEvent[] = [];

  for (const row of rows) {
    if (!isKind(row.kind)) continue;

    if (row.bucket === 'summary') {
      summary.push({
        kind: row.kind,
        actorId: row.actor_id,
        actorName: row.actor_name ?? 'Unknown',
        count: Number(row.entry_count ?? 0),
        amount: row.amount ?? 0,
        afterCloseCount: Number(row.after_close_count ?? 0),
      });
      continue;
    }

    // event_id is non-null on every event row; the fallback keeps React from
    // being handed a duplicate key if that ever stops being true.
    events.push({
      id: `${row.kind}:${row.event_id ?? row.occurred_at}`,
      kind: row.kind,
      actorId: row.actor_id,
      actorName: row.actor_name ?? 'Unknown',
      at: row.occurred_at!,
      invoiceId: row.invoice_id,
      invoiceNo: row.invoice_no,
      patientName: row.patient_name,
      amount: row.amount ?? 0,
      reason: row.reason,
      detail: row.detail,
      afterClose: row.after_close ?? false,
    });
  }

  // The league table, folded from the summary bucket -- which the RPC counted
  // over the WHOLE range, not over the capped event list. Ranked by how many
  // events a person generated, then by how many of those reached back into a
  // closed day, because that is the column somebody actually asks about.
  const people = new Map<string, IntegrityPerson>();

  for (const row of summary) {
    const key = row.actorId ?? 'system';
    const person =
      people.get(key) ??
      ({
        actorId: row.actorId,
        actorName: row.actorName,
        byKind: emptyByKind(),
        total: 0,
        afterClose: 0,
      } satisfies IntegrityPerson);

    person.byKind[row.kind] = {
      count: row.count,
      amount: row.amount,
      afterClose: row.afterCloseCount,
    };
    person.total += row.count;
    person.afterClose += row.afterCloseCount;
    people.set(key, person);
  }

  const totals = emptyByKind();
  for (const row of summary) {
    totals[row.kind].count += row.count;
    totals[row.kind].amount += row.amount;
    totals[row.kind].afterClose += row.afterCloseCount;
  }

  return {
    // UNION ALL does not promise an order, so both lists are sorted here.
    people: [...people.values()].sort(
      (a, b) => b.total - a.total || b.afterClose - a.afterClose,
    ),
    events: events.sort((a, b) => b.at.localeCompare(a.at)),
    totals,
    eventCount: summary.reduce((sum, row) => sum + row.count, 0),
    afterCloseCount: summary.reduce((sum, row) => sum + row.afterCloseCount, 0),
  };
}

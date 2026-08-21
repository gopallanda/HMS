/**
 * Two cashiers, one invoice book.
 *
 * The claim under test, from CLAUDE.md 3.2:
 *
 *   Invoice numbers come from the number_series table via SELECT ... FOR
 *   UPDATE. Never use a Postgres sequence -- numbering must be per-hospital
 *   and per-financial-year, and sequences leak gaps on rollback.
 *
 * A hospital's invoice book is a legal document. Two bills with the same
 * number is not a display bug, it is an audit finding; a missing number is the
 * next question after that. Both are properties of concurrent behaviour, so
 * they are tested against a real Postgres with real concurrent sessions --
 * a mock would only prove the mock behaves.
 *
 * Run:
 *   npm test
 *
 * Needs SUPABASE_DB_URL in .env.local (the same connection scripts/db.mjs
 * uses) and the migrations applied. Without it every test here skips rather
 * than failing, so `npm test` is safe on a machine with no database.
 *
 * Everything runs inside a throwaway tenant -- see tests/support/fixture.mjs.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import {
  FIXTURE,
  anyAuthUser,
  collectPayment,
  connect,
  createVisit,
  databaseUrl,
  invoiceSequence,
  setUp,
  waitUntilBlocked,
  wipe,
} from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

describe('collect_payment invoice numbering', { skip, timeout: 120_000 }, () => {
  /** The connection that sets up, tears down and asserts. */
  let admin;
  /** A separate connection for watching other sessions block. */
  let monitor;
  /** payments.collected_by is NOT NULL, so a payment needs a real login. */
  let collectedBy = null;

  before(async () => {
    admin = await connect(url);
    monitor = await connect(url);
    await setUp(admin);
    collectedBy = await anyAuthUser(admin);
  });

  after(async () => {
    if (admin) {
      await wipe(admin);
      await admin.end();
    }
    if (monitor) await monitor.end();
  });

  /** An amount only when there is somebody to record as having taken it. */
  const paid = () => (collectedBy ? 100 : 0);

  // ---------------------------------------------------------------------------
  test('a second collection waits for the first, and gets the next number', async () => {
    const first = await createVisit(admin);
    const second = await createVisit(admin);

    const cashierA = await connect(url);
    const cashierB = await connect(url);

    try {
      // A starts billing and stops short of committing. next_number() holds
      // the number_series row until the transaction ends, which is the entire
      // mechanism being tested.
      await cashierA.query('begin');
      const invoiceA = await collectPayment(cashierA, {
        ...first,
        amount: paid(),
        collectedBy,
      });

      // B starts billing a DIFFERENT visit, so nothing but the invoice counter
      // is contended. It should not be able to finish.
      await cashierB.query('begin');

      // Settled into a variable rather than left as a rejecting promise: the
      // outcome is inspected several awaits later, and an unhandled rejection
      // in between would take the whole runner down instead of failing here.
      let settled = false;
      let outcome;
      const pending = collectPayment(cashierB, {
        ...second,
        amount: paid(),
        collectedBy,
      }).then(
        (result) => {
          settled = true;
          outcome = { ok: true, result };
        },
        (error) => {
          settled = true;
          outcome = { ok: false, error };
        },
      );

      const blocked = await waitUntilBlocked(monitor, cashierB.processID);

      assert.ok(
        blocked && !settled,
        'the second collection did not wait for the first: the invoice counter is not serialising allocations',
      );

      await cashierA.query('commit');
      await pending;
      assert.ok(outcome.ok, `the second collection failed: ${outcome.error?.message}`);
      await cashierB.query('commit');

      const numberA = invoiceA.rows[0].invoice_no;
      const numberB = outcome.result.rows[0].invoice_no;

      assert.notEqual(numberB, numberA, 'two concurrent collections produced the same invoice number');
      assert.equal(
        invoiceSequence(numberB),
        invoiceSequence(numberA) + 1,
        'the second invoice did not take the next number in the book',
      );
    } finally {
      // A failed assertion leaves a transaction open; nothing else can proceed
      // until it is gone.
      await cashierA.query('rollback').catch(() => {});
      await cashierB.query('rollback').catch(() => {});
      await cashierA.end();
      await cashierB.end();
    }
  });

  // ---------------------------------------------------------------------------
  test('eight simultaneous collections produce eight distinct, gapless numbers', async () => {
    const CASHIERS = 8;

    const visits = [];
    for (let index = 0; index < CASHIERS; index += 1) {
      visits.push(await createVisit(admin));
    }

    const countBefore = await currentCounter(admin);

    const clients = await Promise.all(
      Array.from({ length: CASHIERS }, () => connect(url)),
    );

    try {
      // No barrier, no ordering, no staggering: every session is told to bill
      // at once and they land on the counter however the scheduler decides.
      const results = await Promise.all(
        clients.map(async (client, index) => {
          await client.query('begin');
          const invoice = await collectPayment(client, {
            ...visits[index],
            amount: paid(),
            collectedBy,
          });
          await client.query('commit');
          return invoice.rows[0];
        }),
      );

      const numbers = results.map((invoice) => invoice.invoice_no);
      const unique = new Set(numbers);

      assert.equal(
        unique.size,
        CASHIERS,
        `duplicate invoice numbers under load: ${numbers.sort().join(', ')}`,
      );

      // Distinct is not enough. The book must also have no holes in it, which
      // is the half a Postgres sequence gets wrong.
      const sequences = numbers.map(invoiceSequence).sort((a, b) => a - b);
      const expected = Array.from({ length: CASHIERS }, (_, i) => countBefore + 1 + i);
      assert.deepEqual(sequences, expected, 'the invoice numbers are not consecutive');

      assert.equal(
        await currentCounter(admin),
        countBefore + CASHIERS,
        'number_series disagrees with the invoices that were written',
      );

      // And the constraint that would have caught it anyway, from the other
      // side: one row per number, in this hospital, for this financial year.
      const stored = await admin.query(
        `select count(*)::int as total, count(distinct invoice_no)::int as distinct_numbers
           from public.invoices where hospital_id = $1`,
        [FIXTURE.hospitalId],
      );
      assert.equal(stored.rows[0].total, stored.rows[0].distinct_numbers);
    } finally {
      for (const client of clients) {
        await client.query('rollback').catch(() => {});
        await client.end();
      }
    }
  });

  // ---------------------------------------------------------------------------
  test('a rolled back collection returns its number instead of burning it', async () => {
    // This is the reason CLAUDE.md forbids a sequence. nextval() is exempt
    // from rollback by design, so an abandoned bill would leave a hole in the
    // book forever. A locked counter row does not.
    const doomed = await createVisit(admin);
    const good = await createVisit(admin);

    const countBefore = await currentCounter(admin);

    const cashier = await connect(url);
    try {
      await cashier.query('begin');
      const abandoned = await collectPayment(cashier, {
        ...doomed,
        amount: paid(),
        collectedBy,
      });
      assert.equal(invoiceSequence(abandoned.rows[0].invoice_no), countBefore + 1);
      await cashier.query('rollback');
    } finally {
      await cashier.end();
    }

    assert.equal(await currentCounter(admin), countBefore, 'the counter moved despite the rollback');

    const next = await collectPayment(admin, { ...good, amount: paid(), collectedBy });
    assert.equal(
      invoiceSequence(next.rows[0].invoice_no),
      countBefore + 1,
      'the next invoice skipped a number, so the book has a hole in it',
    );
  });

  // ---------------------------------------------------------------------------
  test('two cashiers billing the SAME visit cannot both charge for it', async () => {
    // The other half of the race. Distinct invoice numbers are no comfort to a
    // patient who paid the same consultation fee twice.
    const shared = await createVisit(admin);

    const cashierA = await connect(url);
    const cashierB = await connect(url);

    try {
      await cashierA.query('begin');
      await collectPayment(cashierA, { ...shared, amount: paid(), collectedBy });

      await cashierB.query('begin');
      let settled = false;
      let outcome;
      const pending = collectPayment(cashierB, {
        ...shared,
        amount: paid(),
        collectedBy,
      }).then(
        (result) => {
          settled = true;
          outcome = { ok: true, result };
        },
        (error) => {
          settled = true;
          outcome = { ok: false, error };
        },
      );

      const blocked = await waitUntilBlocked(monitor, cashierB.processID);
      assert.ok(blocked && !settled, 'the second cashier did not wait on the charge lines');

      await cashierA.query('commit');
      await pending;

      assert.equal(
        outcome.ok,
        false,
        'the second collection was allowed to bill charges that were already invoiced',
      );
      assert.equal(
        outcome.error.code,
        '90002',
        `expected the already-billed error, got: ${outcome.error.message}`,
      );

      await cashierB.query('rollback');

      const invoices = await admin.query(
        `select count(*)::int as total from public.invoices
          where hospital_id = $1 and visit_id = $2 and status <> 'void'`,
        [FIXTURE.hospitalId, shared.visitId],
      );
      assert.equal(invoices.rows[0].total, 1, 'the visit was billed more than once');
    } finally {
      await cashierA.query('rollback').catch(() => {});
      await cashierB.query('rollback').catch(() => {});
      await cashierA.end();
      await cashierB.end();
    }
  });
});

/** Where the hospital's invoice counter stands, for this financial year. */
async function currentCounter(client) {
  const result = await client.query(
    `select coalesce(current_value, 0)::int as value
       from public.number_series
      where hospital_id = $1 and key = 'invoice' and fy = public.financial_year()`,
    [FIXTURE.hospitalId],
  );
  return result.rows[0]?.value ?? 0;
}

/**
 * The 1 April rollover.
 *
 * The claim under test, from CLAUDE.md 3.2:
 *
 *   Invoice numbers are per hospital AND per financial year. The Indian
 *   financial year runs 1 April to 31 March, resolved in Asia/Kolkata
 *   regardless of where the server is, and the counter starts again at 1 in a
 *   new one. The `fy` stored on the invoice is the year the number was drawn
 *   in, and it has to agree with the number printed on the paper.
 *
 * Why this file exists: this fires unattended at midnight IST once a year, on
 * a night nobody is watching, and until now nothing tested it. The failure
 * mode is not a crash -- it is INV/2027-28/00001 landing on top of an invoice
 * that already exists, or the fy column disagreeing with the number on a bill
 * somebody is holding.
 *
 * WHAT IS AND IS NOT SIMULATED
 *
 * Postgres has no supported way to move now() for a session, and this suite
 * will not create-or-replace financial_year() on a shared hosted project to
 * fake one -- another connection would see the shim. So the rollover is proved
 * in the three pieces it is actually made of:
 *
 *   1. financial_year() flips at the right INSTANT, checked either side of
 *      2027-03-31 18:30:00Z, which is midnight IST on 1 April 2027.
 *   2. next_number starts a financial year at 1, because the counter for a
 *      year with no row is created at 0 -- which is exactly the state 1 April
 *      arrives in.
 *   3. counters for different years are independent, so a busy 2026-27 cannot
 *      push 2027-28 off 1.
 *   4. the fy stamped on an invoice equals financial_year() and equals the fy
 *      inside its own invoice_no.
 *
 * Needs SUPABASE_DB_URL. Without it every test here skips rather than failing.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import {
  FIXTURE,
  collectPayment,
  connect,
  createVisit,
  databaseUrl,
  invoiceSequence,
  setUp,
  wipe,
} from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

describe('next_number and the financial year', { skip, timeout: 180_000 }, () => {
  let db;

  before(async () => {
    db = await connect(url);
    await setUp(db);
  });

  after(async () => {
    if (db) {
      await wipe(db);
      await db.end();
    }
  });

  function fyAt(iso) {
    return db
      .query('select public.financial_year($1::timestamptz) as fy', [iso])
      .then((result) => result.rows[0].fy);
  }

  test('the year flips at midnight IST on 1 April, not at midnight UTC', async () => {
    // 18:29:59Z is 23:59:59 IST on 31 March. One second later it is April.
    assert.equal(await fyAt('2027-03-31T18:29:59Z'), '2026-27');
    assert.equal(await fyAt('2027-03-31T18:30:00Z'), '2027-28');

    // The trap this guards: a server in UTC would already have called it
    // 1 April five and a half hours earlier, and numbered five hours of
    // 31 March invoices into the wrong book.
    assert.equal(
      await fyAt('2027-03-31T23:30:00Z'),
      '2027-28',
      'after IST midnight, whatever the server thinks the date is',
    );
    assert.equal(
      await fyAt('2027-04-01T00:30:00Z'),
      '2027-28',
      'and 06:00 IST on 1 April is plainly the new year',
    );

    // Mid-year sanity, both sides.
    assert.equal(await fyAt('2026-04-01T00:00:00Z'), '2026-27');
    assert.equal(await fyAt('2027-01-15T12:00:00Z'), '2026-27');
    assert.equal(await fyAt('2027-12-31T12:00:00Z'), '2027-28');
  });

  test('the fy renders as 2026-27, with the second half padded', async () => {
    // The rollover into a new century is the one that produces 2099-00 rather
    // than 2099-0, and it is a one-character bug on every invoice.
    assert.equal(await fyAt('2099-06-01T00:00:00Z'), '2099-00');
    assert.equal(await fyAt('2100-06-01T00:00:00Z'), '2100-01');
  });

  test('a financial year with no counter row starts at 1', async () => {
    const currentFy = await db
      .query('select public.financial_year() as fy')
      .then((result) => result.rows[0].fy);

    // setUp() wiped number_series for this tenant, so this IS the state a
    // hospital wakes up in on 1 April: the INVOICE counter does not exist yet.
    // (The mrn counter does -- setUp registers a patient, which draws one.
    // That is the point of the per-key primary key and worth asserting past.)
    const before = await db.query(
      "select count(*)::int as n from public.number_series where hospital_id = $1 and key = 'invoice'",
      [FIXTURE.hospitalId],
    );
    assert.equal(before.rows[0].n, 0, 'no invoice counter yet, exactly as on 1 April');

    const first = await db
      .query('select public.next_number($1, $2) as number', [FIXTURE.hospitalId, 'invoice'])
      .then((result) => result.rows[0].number);

    assert.equal(first, `INV/${currentFy}/00001`, 'a fresh year begins at one');

    const second = await db
      .query('select public.next_number($1, $2) as number', [FIXTURE.hospitalId, 'invoice'])
      .then((result) => result.rows[0].number);
    assert.equal(second, `INV/${currentFy}/00002`);

    const row = await db.query(
      'select fy, current_value from public.number_series where hospital_id = $1 and key = $2',
      [FIXTURE.hospitalId, 'invoice'],
    );
    assert.equal(row.rows.length, 1, 'one counter row, for this year only');
    assert.equal(row.rows[0].fy, currentFy);
    assert.equal(Number(row.rows[0].current_value), 2);
  });

  test('a busy year cannot push the next one off 1', async () => {
    const currentFy = await db
      .query('select public.financial_year() as fy')
      .then((result) => result.rows[0].fy);
    const nextFy = await db
      .query("select public.financial_year(now() + interval '1 year') as fy")
      .then((result) => result.rows[0].fy);

    assert.notEqual(nextFy, currentFy, 'a year from now is a different financial year');

    // 4,317 invoices in the current year.
    await db.query(
      `insert into public.number_series (hospital_id, key, fy, current_value)
       values ($1, 'invoice', $2, 4317)
       on conflict (hospital_id, key, fy) do update set current_value = 4317`,
      [FIXTURE.hospitalId, currentFy],
    );

    // The row 1 April will create, at the value it will create it with.
    await db.query(
      `insert into public.number_series (hospital_id, key, fy, current_value)
       values ($1, 'invoice', $2, 0)
       on conflict (hospital_id, key, fy) do update set current_value = 0`,
      [FIXTURE.hospitalId, nextFy],
    );

    const drawn = await db
      .query('select public.next_number($1, $2) as number', [FIXTURE.hospitalId, 'invoice'])
      .then((result) => result.rows[0].number);

    assert.equal(drawn, `INV/${currentFy}/04318`, 'this year continues where it was');

    const untouched = await db.query(
      'select current_value from public.number_series where hospital_id = $1 and key = $2 and fy = $3',
      [FIXTURE.hospitalId, 'invoice', nextFy],
    );
    assert.equal(
      Number(untouched.rows[0].current_value),
      0,
      'and next year is still sitting at zero, ready to hand out 1',
    );
  });

  test('the fy on the invoice matches the number printed on it', async () => {
    // Back to a clean book, so the assertion is about the year rather than
    // about whatever the tests above left behind.
    await db.query('delete from public.number_series where hospital_id = $1', [
      FIXTURE.hospitalId,
    ]);

    const currentFy = await db
      .query('select public.financial_year() as fy')
      .then((result) => result.rows[0].fy);

    const visit = await createVisit(db);
    const invoice = (
      await collectPayment(db, { visitId: visit.visitId, chargeIds: visit.chargeIds, amount: 0 })
    ).rows[0];

    assert.equal(invoice.fy, currentFy, 'the stored fy is the year the number was drawn in');
    assert.equal(
      invoice.invoice_no.split('/')[1],
      invoice.fy,
      'and the paper says the same thing as the column',
    );
    assert.equal(invoiceSequence(invoice.invoice_no), 1, 'first invoice of the year');
    assert.match(invoice.fy, /^[0-9]{4}-[0-9]{2}$/, 'the shape the check constraint demands');
  });
});

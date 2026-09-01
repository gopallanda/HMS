/**
 * Taking somebody off the board.
 *
 * The claims under test, from item 2:
 *
 *   cancel_visit sets a visit to cancelled with a typed reason. An UNPAID
 *   invoice on it is voided through void_invoice, so the number stays consumed
 *   and the charge lines go back to pending. The token is retired, never
 *   reissued. And if any money has already been collected the cancellation is
 *   REFUSED outright -- a queue button does not quietly reverse a payment.
 *
 * Why this file exists: visit_status has had `cancelled` since the first
 * migration and nothing in the product could set it. A patient who walked out
 * left a token in the queue for the rest of the day.
 *
 * Needs SUPABASE_DB_URL. Without it every test here skips rather than failing.
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
  setUp,
  wipe,
} from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

describe('cancel_visit', { skip, timeout: 180_000 }, () => {
  let db;
  let actor = null;

  before(async () => {
    db = await connect(url);
    await setUp(db);
    actor = await anyAuthUser(db);
  });

  after(async () => {
    if (db) {
      await wipe(db);
      await db.end();
    }
  });

  /**
   * cancel_visit returns jsonb, not a composite, so it is selected AS a single
   * column rather than expanded with select *. `select * from f()` on a jsonb
   * function gives one column named after the function, and reading .status
   * off that row is undefined -- which passes as "not cancelled" for exactly
   * the wrong reason.
   */
  async function cancel(visitId, reason) {
    const result = await db.query(
      'select public.cancel_visit($1::uuid, $2::text, $3::uuid) as payload',
      [visitId, reason, FIXTURE.hospitalId],
    );
    return result.rows[0].payload;
  }

  function tokenOf(visitId) {
    return db
      .query('select token_no, status from public.visits where id = $1', [visitId])
      .then((result) => result.rows[0]);
  }

  test('an unpaid invoice is voided and its charges return to the visit', async () => {
    const visit = await createVisit(db);
    const invoice = (
      await collectPayment(db, { visitId: visit.visitId, chargeIds: visit.chargeIds, amount: 0 })
    ).rows[0];

    assert.equal(invoice.status, 'unpaid');

    const result = await cancel(visit.visitId, 'Patient left without waiting to be seen');

    assert.equal(result.status, 'cancelled');
    assert.equal(Number(result.invoices_voided), 1);

    const after = await db.query('select status, void_reason from public.invoices where id = $1', [
      invoice.id,
    ]);
    assert.equal(after.rows[0].status, 'void', 'nothing is deleted -- the number stays consumed');
    assert.match(
      after.rows[0].void_reason,
      /cancelled: Patient left without waiting/,
      'and the void reason says which cancellation it came from',
    );

    const charges = await db.query(
      'select status, invoice_id from public.charge_items where visit_id = $1',
      [visit.visitId],
    );
    for (const line of charges.rows) {
      assert.equal(line.status, 'pending', 'the lines go back to unbilled');
      assert.equal(line.invoice_id, null);
    }
  });

  test('the reason reaches audit_log, which is the only place it lives', async () => {
    const visit = await createVisit(db);
    await cancel(visit.visitId, 'Called three times, no answer');

    const audit = await db.query(
      `select action, after from public.audit_log
        where hospital_id = $1 and table_name = 'visit_cancellation' and record_id = $2`,
      [FIXTURE.hospitalId, visit.visitId],
    );

    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].action, 'insert');
    assert.equal(audit.rows[0].after.reason, 'Called three times, no answer');
  });

  test('the token is retired, never handed to the next patient', async () => {
    const cancelled = await createVisit(db);
    const retired = (await tokenOf(cancelled.visitId)).token_no;

    await cancel(cancelled.visitId, 'Patient left without waiting to be seen');

    // Somebody in the waiting room is holding a slip with `retired` on it.
    const next = await createVisit(db);
    const issued = (await tokenOf(next.visitId)).token_no;

    assert.ok(
      issued > retired,
      `token ${retired} was reissued as ${issued}: two people would answer one call`,
    );
  });

  test('a visit with money against it is refused, not silently reversed', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so no payment can be attributed');
      return;
    }

    const visit = await createVisit(db);
    const invoice = (
      await collectPayment(db, {
        visitId: visit.visitId,
        chargeIds: visit.chargeIds,
        amount: FIXTURE.consultationFee,
        collectedBy: actor,
      })
    ).rows[0];
    assert.equal(invoice.status, 'paid');

    await assert.rejects(
      () => cancel(visit.visitId, 'Patient changed their mind after paying'),
      (error) => {
        assert.match(error.message, /already been collected/);
        assert.match(String(error.hint ?? ''), /Reverse the payment|void the invoice/i);
        return true;
      },
    );

    // Nothing moved. That is the whole point: a refusal that half-cancelled
    // the visit would be worse than no feature at all.
    const state = await tokenOf(visit.visitId);
    assert.notEqual(state.status, 'cancelled');

    const still = await db.query('select status from public.invoices where id = $1', [invoice.id]);
    assert.equal(still.rows[0].status, 'paid');
  });

  test('a completed or already cancelled visit is refused, and so is a bare reason', async () => {
    const done = await createVisit(db);
    await db.query('select public.set_visit_status($1, $2, $3)', [
      done.visitId,
      'completed',
      FIXTURE.hospitalId,
    ]);

    await assert.rejects(
      () => cancel(done.visitId, 'Changed our minds about this one'),
      /already been completed/,
    );

    const twice = await createVisit(db);
    await cancel(twice.visitId, 'Patient left without waiting to be seen');
    await assert.rejects(() => cancel(twice.visitId, 'Trying again'), /already cancelled/);

    const bare = await createVisit(db);
    await assert.rejects(() => cancel(bare.visitId, 'no'), /Say why/);
    await assert.rejects(() => cancel(bare.visitId, '   '), /Say why/);
  });
});

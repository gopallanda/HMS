/**
 * Correcting one payment without destroying the bill.
 *
 * The claims under test, from item 3:
 *
 *   reverse_payment marks ONE payment reversed with a typed reason and
 *   recomputes the invoice status from the rows that are left -- so paid can
 *   go back to partial or to unpaid. It refuses an already-reversed payment,
 *   and the day-close report stops counting the money, because money handed
 *   back is not money in the drawer.
 *
 * Why this file exists: is_reversed and reversal_reason had existed since the
 * billing slice with nothing but void_invoice ever setting them, so a cash
 * payment recorded as UPI could only be fixed by voiding an otherwise correct
 * invoice.
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

describe('reverse_payment', { skip, timeout: 180_000 }, () => {
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

  function reverse(paymentId, reason) {
    return db.query('select * from public.reverse_payment($1::uuid, $2::text, $3::uuid)', [
      paymentId,
      reason,
      FIXTURE.hospitalId,
    ]);
  }

  function addPayment(invoiceId, amount, mode) {
    return db.query(
      `select * from public.add_payment(
         p_invoice_id => $1::uuid, p_amount => $2::numeric, p_mode => $3::public.payment_mode,
         p_reference => null, p_hospital_id => $4::uuid, p_payment_id => null,
         p_collected_by => $5::uuid)`,
      [invoiceId, amount, mode, FIXTURE.hospitalId, actor],
    );
  }

  function paymentsOn(invoiceId) {
    return db
      .query('select id, amount, is_reversed from public.payments where invoice_id = $1 order by paid_at', [
        invoiceId,
      ])
      .then((result) => result.rows);
  }

  /** The one figure a cashier reconciles against the cash box. */
  async function collectedToday() {
    const result = await db.query(
      `select amount from public.day_close_report($1::uuid, public.ist_date(now()))
        where bucket = 'total' and key = 'collected'`,
      [FIXTURE.hospitalId],
    );
    return Number(result.rows[0].amount);
  }

  test('paid goes back to partial, and the day-close total drops', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so no payment can be attributed');
      return;
    }

    const visit = await createVisit(db);
    const invoice = (
      await collectPayment(db, {
        visitId: visit.visitId,
        chargeIds: visit.chargeIds,
        amount: 200,
        collectedBy: actor,
      })
    ).rows[0];

    await addPayment(invoice.id, Number(invoice.grand_total) - 200, 'upi');

    const settled = await db.query('select status from public.invoices where id = $1', [invoice.id]);
    assert.equal(settled.rows[0].status, 'paid');

    const before = await collectedToday();
    const [first] = await paymentsOn(invoice.id);

    const after = (await reverse(first.id, 'Taken in cash, recorded as UPI by mistake')).rows[0];

    assert.equal(
      after.status,
      'partial',
      'the status comes from the remaining rows, not from what was removed',
    );

    const total = await collectedToday();
    assert.equal(
      total,
      Math.round((before - Number(first.amount)) * 100) / 100,
      'money handed back is not money in the drawer',
    );

    const rows = await paymentsOn(invoice.id);
    assert.equal(rows.length, 2, 'nothing is deleted');
    assert.equal(rows[0].is_reversed, true);
    assert.equal(rows[1].is_reversed, false);
  });

  test('reversing the only payment takes the invoice back to unpaid', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
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

    const [only] = await paymentsOn(invoice.id);
    const after = (await reverse(only.id, 'Cheque bounced')).rows[0];

    assert.equal(after.status, 'unpaid');

    const summary = await db.query(
      'select paid_total, balance from public.invoice_summary where id = $1',
      [invoice.id],
    );
    assert.equal(Number(summary.rows[0].paid_total), 0);
    assert.equal(Number(summary.rows[0].balance), Number(invoice.grand_total));

    const due = await db.query('select public.visit_payment_due($1, $2) as due', [
      FIXTURE.hospitalId,
      visit.visitId,
    ]);
    assert.equal(due.rows[0].due, true, 'and PAYMENT DUE comes back on the queue');
  });

  test('a second reversal is refused, and a bare reason is refused', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
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

    const [only] = await paymentsOn(invoice.id);

    await assert.rejects(() => reverse(only.id, 'x'), /Say why/);

    await reverse(only.id, 'Recorded against the wrong bill');
    await assert.rejects(() => reverse(only.id, 'Trying again'), /already reversed/);
  });

  test('a payment on a void invoice leaves the invoice void', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
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

    // void_invoice reverses the payments itself, so a second reversal of the
    // same row must be refused rather than recomputing the invoice to unpaid
    // and putting a bill nobody owes onto the dues report.
    await db.query('select public.void_invoice($1, $2, $3)', [
      invoice.id,
      'Billed to the wrong patient at the counter',
      FIXTURE.hospitalId,
    ]);

    const [only] = await paymentsOn(invoice.id);
    assert.equal(only.is_reversed, true, 'void_invoice already reversed it');

    await assert.rejects(() => reverse(only.id, 'Trying to reverse it again'), /already reversed/);

    const state = await db.query('select status from public.invoices where id = $1', [invoice.id]);
    assert.equal(state.rows[0].status, 'void');
  });
});

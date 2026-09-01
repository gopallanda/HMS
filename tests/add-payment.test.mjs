/**
 * Settling a bill that already exists.
 *
 * The claim under test, from item 1 and CLAUDE.md 3.2:
 *
 *   add_payment records money against an invoice that is already there. It
 *   never allocates a number, never writes an invoice, recomputes the status
 *   from the payment ROWS rather than from the amount passed in, refuses more
 *   than the outstanding balance, and is idempotent on a client-supplied
 *   payment id.
 *
 * Why this file exists: before add_payment, the deferred path of
 * register_patient_visit left an `unpaid` invoice whose charge was already
 * `invoiced`. visit_billing.pending_count was 0, the collect desk showed the
 * visit as billed with nothing to do, and the money was unreachable from every
 * screen in the product. That is the first test below, end to end.
 *
 * Run:
 *   npm test
 *
 * Needs SUPABASE_DB_URL in .env.local and the migrations applied. Without it
 * every test here skips rather than failing, so `npm test` is safe on a
 * machine with no database -- and on a fork's CI, where the secret is absent.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import { FIXTURE, anyAuthUser, connect, databaseUrl, setUp, wipe } from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

describe('add_payment', { skip, timeout: 180_000 }, () => {
  let db;
  /** payments.collected_by is NOT NULL, so a payment needs a real login. */
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

  /** The RPC, with the two arguments that exist only for callers with no JWT. */
  function addPayment({ invoiceId, amount, mode = 'cash', reference = null, paymentId = null }) {
    return db.query(
      // In FROM, never `select (add_payment(...)).*`: that form expands the
      // composite by re-evaluating the function once per output column, which
      // would bank the money seventeen times.
      `select * from public.add_payment(
         p_invoice_id   => $1::uuid,
         p_amount       => $2::numeric,
         p_mode         => $3::public.payment_mode,
         p_reference    => $4::text,
         p_hospital_id  => $5::uuid,
         p_payment_id   => $6::uuid,
         p_collected_by => $7::uuid
       )`,
      [invoiceId, amount, mode, reference, FIXTURE.hospitalId, paymentId, actor],
    );
  }

  /** A registration through the real desk path. Deferred leaves it unpaid. */
  async function register({ deferred }) {
    const result = await db.query(
      `select public.register_patient_visit(
         p_hospital_id  => $1::uuid,
         p_patient_id   => $2::uuid,
         p_doctor_id    => $3::uuid,
         p_payment_mode => $4::text,
         p_deferred     => $5::boolean,
         p_defer_reason => $6::text,
         p_actor_id     => $7::uuid
       ) as payload`,
      [
        FIXTURE.hospitalId,
        FIXTURE.patientId,
        FIXTURE.doctorId,
        deferred ? null : 'cash',
        deferred,
        deferred ? 'Patient returning after the ATM' : null,
        actor,
      ],
    );
    return result.rows[0].payload;
  }

  function invoice(id) {
    return db
      .query('select * from public.invoices where id = $1', [id])
      .then((result) => result.rows[0]);
  }

  test('a deferred registration can be collected, and the invoice reaches paid', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so no payment can be attributed');
      return;
    }

    const registered = await register({ deferred: true });
    const before = await invoice(registered.invoice_id);

    assert.equal(before.status, 'unpaid', 'a deferred registration leaves the invoice unpaid');
    assert.equal(registered.payment_due, true, 'and the desk is told so');

    // This is the shape that made the money unreachable: the charge is already
    // attached to the invoice, so the collect desk has nothing pending to bill.
    const pending = await db.query(
      `select pending_count from public.visit_billing
        where hospital_id = $1 and visit_id = $2`,
      [FIXTURE.hospitalId, registered.visit_id],
    );
    assert.equal(
      Number(pending.rows[0].pending_count),
      0,
      'nothing is pending on the visit, which is exactly why collect_payment could not help',
    );

    const after = (await addPayment({
      invoiceId: registered.invoice_id,
      amount: before.grand_total,
    })).rows[0];

    assert.equal(after.status, 'paid');
    assert.equal(Number(after.grand_total), Number(before.grand_total), 'the bill did not change');
    assert.equal(after.invoice_no, before.invoice_no, 'and no second number was drawn');

    const invoiceCount = await db.query(
      'select count(*)::int as n from public.invoices where visit_id = $1',
      [registered.visit_id],
    );
    assert.equal(invoiceCount.rows[0].n, 1, 'add_payment must never create an invoice');

    const due = await db.query('select public.visit_payment_due($1, $2) as due', [
      FIXTURE.hospitalId,
      registered.visit_id,
    ]);
    assert.equal(due.rows[0].due, false, 'and PAYMENT DUE is finally clear');
  });

  test('a part payment can be topped up, and partial is not a one-way door', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
      return;
    }

    const registered = await register({ deferred: true });
    const bill = Number((await invoice(registered.invoice_id)).grand_total);

    const half = Math.round((bill / 2) * 100) / 100;
    const partial = (await addPayment({ invoiceId: registered.invoice_id, amount: half })).rows[0];
    assert.equal(partial.status, 'partial');

    const settled = (await addPayment({
      invoiceId: registered.invoice_id,
      amount: bill - half,
      mode: 'upi',
      reference: 'UPI/000111222',
    })).rows[0];

    assert.equal(
      settled.status,
      'paid',
      'the status comes from the sum of the rows, not from the last amount passed in',
    );

    const summary = await db.query(
      'select paid_total, balance from public.invoice_summary where id = $1',
      [registered.invoice_id],
    );
    assert.equal(Number(summary.rows[0].paid_total), bill);
    assert.equal(Number(summary.rows[0].balance), 0);
  });

  test('more than the outstanding balance is refused, naming the balance', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
      return;
    }

    const registered = await register({ deferred: true });
    const bill = Number((await invoice(registered.invoice_id)).grand_total);

    await addPayment({ invoiceId: registered.invoice_id, amount: 100 });

    await assert.rejects(
      () => addPayment({ invoiceId: registered.invoice_id, amount: bill }),
      (error) => {
        // The message has to carry the REAL balance, not the bill: the cashier
        // is looking at a screen that may be a minute out of date.
        assert.match(error.message, new RegExp(String(bill - 100)));
        return true;
      },
      'a payment over the remaining balance must be refused, not banked',
    );

    const rows = await db.query(
      'select count(*)::int as n from public.payments where invoice_id = $1',
      [registered.invoice_id],
    );
    assert.equal(rows.rows[0].n, 1, 'and nothing was written');
  });

  test('replaying a payment id banks the money once', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
      return;
    }

    const registered = await register({ deferred: true });
    const bill = Number((await invoice(registered.invoice_id)).grand_total);
    const paymentId = '00000000-0000-4000-8000-0000000000e1';

    const first = (await addPayment({
      invoiceId: registered.invoice_id,
      amount: bill,
      paymentId,
    })).rows[0];
    assert.equal(first.status, 'paid');

    // The dropped-connection retry. It must return the invoice as it stands
    // rather than refusing it as already paid -- a refusal here would make a
    // resubmitted dialog look like a failed collection.
    const replay = (await addPayment({
      invoiceId: registered.invoice_id,
      amount: bill,
      paymentId,
    })).rows[0];

    assert.equal(replay.status, 'paid');
    assert.equal(replay.id, first.id);

    const rows = await db.query(
      'select count(*)::int as n, sum(amount) as total from public.payments where invoice_id = $1',
      [registered.invoice_id],
    );
    assert.equal(rows.rows[0].n, 1, 'one payment, not two');
    assert.equal(Number(rows.rows[0].total), bill);
  });

  test('a void invoice and a paid invoice both refuse further collection', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
      return;
    }

    const paid = await register({ deferred: false });
    await assert.rejects(
      () => addPayment({ invoiceId: paid.invoice_id, amount: 1 }),
      /already paid in full/,
    );

    const voided = await register({ deferred: true });
    await db.query('select public.void_invoice($1, $2, $3)', [
      voided.invoice_id,
      'Billed to the wrong patient',
      FIXTURE.hospitalId,
    ]);

    await assert.rejects(
      () => addPayment({ invoiceId: voided.invoice_id, amount: 1 }),
      /voided/,
      'a voided bill is a closed matter, not a debt',
    );
  });

  test('a non-positive amount is refused', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project');
      return;
    }

    const registered = await register({ deferred: true });

    await assert.rejects(() => addPayment({ invoiceId: registered.invoice_id, amount: 0 }));
    await assert.rejects(() => addPayment({ invoiceId: registered.invoice_id, amount: -50 }));
  });
});

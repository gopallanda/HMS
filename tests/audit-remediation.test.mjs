/**
 * The two money controls added on 2026-09-23, and the one thing they each have
 * to refuse.
 *
 * WHAT IS UNDER TEST
 *
 * 1. THE CONSULTATION FEE IS NOT A FIELD (20260923090100). A signed-in caller
 *    may not pass a p_fee that disagrees with the doctor's staff row. Before
 *    this, the app's only gate on that field was billing.collect -- the
 *    permission a register desk exists to hold -- so the price of a
 *    consultation was free text for every receptionist, and a 500 rupee fee
 *    keyed as 100 left an invoice saying 100 and no record that anything had
 *    been reduced. A reduction now goes through p_discount, which carries a
 *    reason onto invoices.discount_amount.
 *
 * 2. CANCELLING SAYS WHAT HAPPENS TO THE MONEY (20260923090000). cancel_visit
 *    used to refuse any visit with a live payment and tell the user to fix it
 *    at a counter the front desk has no permission to use -- while registration
 *    gives every visit a paid invoice the moment it exists. p_money = 'retain'
 *    cancels and leaves the payment alone; 'refund' voids and reverses; omitting
 *    it still refuses (tested in cancel-visit.test.mjs).
 *
 * WHY asSession() IS USED FOR HALF OF THIS AND NOT THE OTHER HALF
 *
 * Claim 1 only exists for callers WITH a session -- seed.sql and these tests
 * price registrations through p_fee and must keep working -- so testing it as
 * the service role would test the exemption rather than the rule. Claim 2
 * applies to everybody, so it is tested the plain way.
 *
 * Needs SUPABASE_DB_URL. Without it every test here skips rather than failing.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import {
  FIXTURE,
  anyAuthUser,
  asSession,
  collectPayment,
  connect,
  createVisit,
  customStaff,
  databaseUrl,
  roleIdByCode,
  setUp,
  wipe,
} from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

describe('registration fee lock and concession', { skip, timeout: 180_000 }, () => {
  let db;
  let actor = null;

  before(async () => {
    db = await connect(url);
    await setUp(db);
    actor = await anyAuthUser(db);

    // A STAFF ROW on the seeded front_desk role, not just a front_desk claim.
    // Since 20260923090200 assert_front_desk() asks whether the caller holds a
    // register-desk PERMISSION rather than whether their membership is named
    // front_desk, and permissions are resolved through staff -> roles ->
    // role_permissions. A login with a membership and no staff row holds
    // nothing -- which is the same answer lib/rbac/resolve.ts gives, and is not
    // a state provisioning can produce: provisionStaffAccount writes the staff
    // row first.
    if (actor !== null) {
      const deskRole = await roleIdByCode(db, 'front_desk');
      await customStaff(db, { userId: actor, roleId: deskRole, fullName: 'Desk Clerk' });
    }
  });

  after(async () => {
    if (db) {
      await wipe(db);
      await db.end();
    }
  });

  /**
   * One registration, as a signed-in front-desk clerk. Named arguments
   * throughout: the function has fourteen and two of them were added on the end.
   */
  function register(
    client,
    { name, fee = null, discount = 0, discountReason = null, actorId = null },
  ) {
    // p_actor_id is the one that exists only for callers with no JWT: with a
    // session, collect_payment takes the collector from auth.uid() and REFUSES
    // an argument that names somebody else. payments.collected_by is NOT NULL
    // either way (CLAUDE.md 3.2), so the service-role path has to supply it --
    // which is exactly what seed.sql does.
    return client
      .query(
        `select public.register_patient_visit(
           p_hospital_id     => $1::uuid,
           p_patient         => jsonb_build_object(
                                  'full_name', $2::text,
                                  'dob',       '1985-05-05',
                                  'gender',    'other',
                                  'phone',     '9845000111'
                                ),
           p_doctor_id       => $3::uuid,
           p_fee             => $4::numeric,
           p_payment_mode    => 'cash',
           p_discount        => $5::numeric,
           p_discount_reason => $6::text,
           p_actor_id        => $7::uuid
         ) as payload`,
        [FIXTURE.hospitalId, name, FIXTURE.doctorId, fee, discount, discountReason, actorId],
      )
      .then((result) => result.rows[0].payload);
  }

  test("a signed-in caller cannot bill a fee the doctor's record does not agree with", async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await assert.rejects(
      () =>
        asSession(db, { userId: actor }, (client) =>
          register(client, { name: 'Underbilled Patient', fee: 100 }),
        ),
      (error) => {
        assert.match(
          error.message,
          /own fee/,
          'the refusal names the doctor and their fee, not a constraint',
        );
        assert.equal(error.code, '42501', 'and it is a permission refusal, not a typo');
        return true;
      },
    );

    // The whole transaction is gone: no patient, no visit, no number burnt.
    const left = await db.query(
      'select count(*)::int as n from public.patients where hospital_id = $1 and full_name = $2',
      [FIXTURE.hospitalId, 'Underbilled Patient'],
    );
    assert.equal(left.rows[0].n, 0, 'a refused registration leaves nothing behind');
  });

  test("the doctor's own fee is accepted, whether it is passed or left out", async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    const implied = await asSession(db, { userId: actor }, (client) =>
      register(client, { name: 'Fee From Staff Row' }),
    );
    assert.equal(Number(implied.grand_total), FIXTURE.consultationFee);

    const explicit = await asSession(db, { userId: actor }, (client) =>
      register(client, { name: 'Fee Passed Back', fee: FIXTURE.consultationFee }),
    );
    assert.equal(Number(explicit.grand_total), FIXTURE.consultationFee);
  });

  test('a concession reduces the bill, and lands on the invoice with its reason', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    const result = await asSession(db, { userId: actor }, (client) =>
      register(client, {
        name: 'Concession Patient',
        discount: 200,
        discountReason: 'Staff family concession',
      }),
    );

    assert.equal(
      Number(result.grand_total),
      FIXTURE.consultationFee - 200,
      'the bill is the fee less the concession',
    );
    assert.equal(result.payment_due, false, 'and what was asked for was paid in full');

    const invoice = await db.query(
      `select subtotal, discount_amount, discount_reason, grand_total, status
         from public.invoices where id = $1`,
      [result.invoice_id],
    );
    const row = invoice.rows[0];

    assert.equal(
      Number(row.subtotal),
      FIXTURE.consultationFee,
      'the LINE is still the full fee -- that is the fact the old free-text field destroyed',
    );
    assert.equal(Number(row.discount_amount), 200);
    assert.equal(row.discount_reason, 'Staff family concession');
    assert.equal(row.status, 'paid');

    const payment = await db.query(
      'select amount from public.payments where invoice_id = $1 and not is_reversed',
      [result.invoice_id],
    );
    assert.equal(
      Number(payment.rows[0].amount),
      FIXTURE.consultationFee - 200,
      'and only what the patient actually handed over was banked',
    );
  });

  test('a concession with no reason, or bigger than the fee, is refused', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await assert.rejects(
      () =>
        asSession(db, { userId: actor }, (client) =>
          register(client, { name: 'No Reason', discount: 100 }),
        ),
      /Say why this concession/,
    );

    await assert.rejects(
      () =>
        asSession(db, { userId: actor }, (client) =>
          register(client, { name: 'No Reason', discount: 100, discountReason: 'x' }),
        ),
      /Say why this concession/,
    );

    await assert.rejects(
      () =>
        asSession(db, { userId: actor }, (client) =>
          register(client, {
            name: 'Too Much',
            discount: FIXTURE.consultationFee + 1,
            discountReason: 'Free for this family',
          }),
        ),
      /more than the consultation fee/,
    );
  });

  test('the service role keeps its override, because seed.sql prices through it', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so no payment can be attributed');
      return;
    }

    // No session: auth.uid() is null, so the rule is exempt on purpose. Without
    // this, applying 20260923090100 would break every seeded registration.
    const result = await register(db, { name: 'Seeded Patient', fee: 250, actorId: actor });
    assert.equal(Number(result.grand_total), 250);
  });
});

describe('cancel_visit settlement', { skip, timeout: 180_000 }, () => {
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

  function cancel(visitId, reason, money) {
    return db
      .query('select public.cancel_visit($1::uuid, $2::text, $3::uuid, $4::text) as payload', [
        visitId,
        reason,
        FIXTURE.hospitalId,
        money,
      ])
      .then((result) => result.rows[0].payload);
  }

  async function paidVisit() {
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
    return { visitId: visit.visitId, invoiceId: invoice.id };
  }

  test('retain cancels the visit and leaves the paid invoice exactly as it was', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so no payment can be attributed');
      return;
    }

    const { visitId, invoiceId } = await paidVisit();

    const result = await cancel(visitId, 'Waited an hour and left; keeping the fee', 'retain');

    assert.equal(result.status, 'cancelled', 'the board is cleared, which is the point');
    assert.equal(Number(result.invoices_voided), 0);
    assert.equal(Number(result.payments_retained), FIXTURE.consultationFee);

    const invoice = await db.query(
      'select status, void_reason from public.invoices where id = $1',
      [invoiceId],
    );
    assert.equal(invoice.rows[0].status, 'paid', 'money that is still in the drawer says so');
    assert.equal(invoice.rows[0].void_reason, null);

    const payment = await db.query(
      'select is_reversed from public.payments where invoice_id = $1',
      [invoiceId],
    );
    assert.equal(payment.rows[0].is_reversed, false, 'nothing was reversed');

    // And the decision is on the record, not merely its effect.
    const audit = await db.query(
      `select after from public.audit_log
        where hospital_id = $1 and table_name = 'visit_cancellation' and record_id = $2`,
      [FIXTURE.hospitalId, visitId],
    );
    assert.equal(audit.rows[0].after.money, 'retain');
    assert.equal(Number(audit.rows[0].after.payments_retained), FIXTURE.consultationFee);
  });

  test('refund voids the invoice and reverses the payment', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so no payment can be attributed');
      return;
    }

    const { visitId, invoiceId } = await paidVisit();

    const result = await cancel(visitId, 'Cash handed back at the counter', 'refund');

    assert.equal(result.status, 'cancelled');
    assert.equal(Number(result.invoices_voided), 1);
    assert.equal(Number(result.payments_retained), 0);

    const invoice = await db.query(
      'select status, void_reason from public.invoices where id = $1',
      [invoiceId],
    );
    assert.equal(invoice.rows[0].status, 'void');
    assert.match(invoice.rows[0].void_reason, /Cash handed back/);

    const payment = await db.query(
      'select is_reversed, reversal_reason from public.payments where invoice_id = $1',
      [invoiceId],
    );
    assert.equal(payment.rows[0].is_reversed, true);
    assert.match(payment.rows[0].reversal_reason, /Cash handed back/);
  });

  test('retain still voids a bill with nothing collected on it', async () => {
    const visit = await createVisit(db);
    const invoice = (
      await collectPayment(db, { visitId: visit.visitId, chargeIds: visit.chargeIds, amount: 0 })
    ).rows[0];
    assert.equal(invoice.status, 'unpaid');

    // There is nothing on this one to keep, so the answer is the same either
    // way: the number stays consumed and the charges go back to pending.
    const result = await cancel(visit.visitId, 'Never seen, nothing collected', 'retain');

    assert.equal(Number(result.invoices_voided), 1);
    assert.equal(Number(result.payments_retained), 0);

    const after = await db.query('select status from public.invoices where id = $1', [invoice.id]);
    assert.equal(after.rows[0].status, 'void');
  });

  test('a settlement that is neither answer is refused', async () => {
    const visit = await createVisit(db);
    await assert.rejects(
      () => cancel(visit.visitId, 'Patient left without waiting', 'keep_half'),
      /retains the payment or refunds it/,
    );
  });
});

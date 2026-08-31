/**
 * Registration is one transaction.
 *
 * The claim under test, from block 4 of the phase 1 remediation:
 *
 *   A visit can no longer exist with no doctor, no token and no money asked
 *   for. Patient, MRN, visit, visit number, token, invoice, invoice number and
 *   payment are written together or not at all.
 *
 * Three of these are properties of CONCURRENT behaviour and cannot be shown any
 * other way than with real sessions against real Postgres: that two clerks
 * registering at the same instant get different MRNs and different tokens, and
 * that a failure part way through leaves nothing behind. A mock would only
 * prove the mock behaves.
 *
 * Run:
 *   npm test
 *
 * Needs SUPABASE_DB_URL in .env.local and the migrations applied. Without it
 * every test here skips rather than failing.
 *
 * Everything runs inside the same throwaway tenant the billing tests use --
 * see tests/support/fixture.mjs.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import { FIXTURE, anyAuthUser, connect, databaseUrl, setUp, wipe } from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

/**
 * One registration, exactly as the Server Action sends it plus the two
 * arguments that exist only for callers with no JWT (the seed, and this).
 *
 * p_patient_id null means "create one", which is the path with the MRN
 * allocation in it.
 *
 * p_actor_id is the argument that exists for callers with no JWT: a signed-in
 * clerk is recorded from auth.uid() and cannot override it, but payments
 * .collected_by is NOT NULL (CLAUDE.md 3.2) so a test taking real money needs
 * a real login to attribute it to.
 */
function register(
  client,
  { doctorId, name, deferred = false, reason = null, fee = null, actorId = null },
) {
  return client.query(
    `select public.register_patient_visit(
       p_hospital_id   => $1::uuid,
       p_patient_id    => null,
       p_patient       => jsonb_build_object(
                            'full_name', $2::text,
                            'dob',       '1990-01-01',
                            'gender',    'other',
                            'phone',     '9845000000'
                          ),
       p_doctor_id     => $3::uuid,
       p_department_id => null,
       p_fee           => $4::numeric,
       p_payment_mode  => case when $5::boolean then null else 'cash' end,
       p_deferred      => $5::boolean,
       p_defer_reason  => $6::text,
       p_actor_id      => $7::uuid
     ) as result`,
    [FIXTURE.hospitalId, name, doctorId, fee, deferred, reason, actorId],
  );
}

describe('register_patient_visit', { skip, timeout: 180_000 }, () => {
  let admin;
  /** payments.collected_by is NOT NULL, so a payment needs a real login. */
  let actorId = null;

  before(async () => {
    admin = await connect(url);
    await setUp(admin);
    actorId = await anyAuthUser(admin);
  });

  after(async () => {
    if (admin) {
      await wipe(admin);
      await admin.end();
    }
  });

  test('writes the patient, visit, token and invoice in one call', async () => {
    const { rows } = await register(admin, { doctorId: FIXTURE.doctorId, name: 'One Call', actorId });
    const result = rows[0].result;

    assert.ok(result.mrn, 'an MRN was allocated');
    assert.ok(result.visit_no, 'a visit number was allocated');
    assert.ok(result.invoice_no, 'an invoice number was allocated');
    assert.equal(result.token_no, 1, 'the first patient of the day is token 1');
    assert.equal(result.payment_due, false, 'a cash registration is paid');

    // The money actually landed, not just the invoice.
    const payment = await admin.query(
      'select amount, mode from public.payments where hospital_id = $1 and invoice_id = $2',
      [FIXTURE.hospitalId, result.invoice_id],
    );
    assert.equal(payment.rows.length, 1);
    assert.equal(Number(payment.rows[0].amount), FIXTURE.consultationFee);
    assert.equal(payment.rows[0].mode, 'cash');
  });

  test('tokens are per doctor, so two doctors both start at 1', async () => {
    const first = await register(admin, { doctorId: FIXTURE.doctorId, name: 'Queue A', actorId });
    const second = await register(admin, { doctorId: FIXTURE.doctorTwoId, name: 'Queue B', actorId });

    // The first doctor already has token 1 from the test above, so this is 2.
    assert.equal(first.rows[0].result.token_no, 2);
    // The second doctor has nobody, so their queue starts at 1 -- which the
    // old hospital-wide index would have refused outright.
    assert.equal(second.rows[0].result.token_no, 1);
  });

  test('a doctor is required, and so is a payment mode', async () => {
    await assert.rejects(
      () =>
        admin.query(
          `select public.register_patient_visit(
             p_hospital_id => $1::uuid,
             p_patient     => jsonb_build_object('full_name','No Doctor','dob','1990-01-01','gender','other'),
             p_doctor_id   => null,
             p_payment_mode => 'cash'
           )`,
          [FIXTURE.hospitalId],
        ),
      /Choose a doctor/,
      'the database refuses a visit with no doctor, not only the form',
    );

    await assert.rejects(
      () =>
        admin.query(
          `select public.register_patient_visit(
             p_hospital_id => $1::uuid,
             p_patient     => jsonb_build_object('full_name','No Mode','dob','1990-01-01','gender','other'),
             p_doctor_id   => $2::uuid,
             p_payment_mode => null,
             p_deferred    => false
           )`,
          [FIXTURE.hospitalId, FIXTURE.doctorId],
        ),
      /how the payment was made/,
      'a payment mode is required unless the deferral path was used',
    );
  });

  test('a deferral needs a reason, and leaves the invoice owing', async () => {
    await assert.rejects(
      () => register(admin, { doctorId: FIXTURE.doctorId, name: 'No Reason', deferred: true }),
      /why the patient is being seen before paying/,
    );

    const { rows } = await register(admin, {
      doctorId: FIXTURE.doctorId,
      name: 'Deferred Patient',
      deferred: true,
      reason: 'Emergency, will settle at discharge',
    });
    const result = rows[0].result;

    assert.equal(result.payment_due, true, 'the invoice is left owing');

    // PAYMENT DUE is DERIVED from the invoice, not stored a second time.
    const due = await admin.query('select public.visit_payment_due($1, $2) as due', [
      FIXTURE.hospitalId,
      result.visit_id,
    ]);
    assert.equal(due.rows[0].due, true);

    const deferral = await admin.query(
      'select reason from public.visit_payment_deferrals where hospital_id = $1 and visit_id = $2',
      [FIXTURE.hospitalId, result.visit_id],
    );
    assert.equal(deferral.rows.length, 1, 'the deferral is recorded, not silent');
    assert.match(deferral.rows[0].reason, /discharge/);
  });

  test('a failure part way through leaves no orphan patient, visit or invoice', async () => {
    const before = await counts(admin);

    // A fee larger than numeric(12,2) can hold makes collect_payment's insert
    // fail AFTER the patient, the MRN, the visit and the token have been
    // written. If any of those survive, registration is not one transaction.
    await assert.rejects(
      () =>
        register(admin, {
          doctorId: FIXTURE.doctorId,
          name: 'Doomed Registration',
          fee: 99_999_999_999,
          actorId,
        }),
      /./,
    );

    const after = await counts(admin);
    assert.deepEqual(after, before, 'nothing at all was left behind');

    const orphan = await admin.query(
      "select 1 from public.patients where hospital_id = $1 and full_name = 'Doomed Registration'",
      [FIXTURE.hospitalId],
    );
    assert.equal(orphan.rows.length, 0, 'no patient was stranded without a visit');
  });

  test('two clerks registering at the same instant get different MRNs and tokens', async () => {
    const clerks = await Promise.all([connect(url), connect(url), connect(url), connect(url)]);

    try {
      const results = await Promise.all(
        clerks.map((clerk, index) =>
          register(clerk, { doctorId: FIXTURE.doctorId, name: `Simultaneous ${index}`, actorId }),
        ),
      );

      const mrns = results.map((row) => row.rows[0].result.mrn);
      const tokens = results.map((row) => row.rows[0].result.token_no);
      const invoices = results.map((row) => row.rows[0].result.invoice_no);

      assert.equal(new Set(mrns).size, mrns.length, `MRNs collided: ${mrns.join(', ')}`);
      assert.equal(new Set(tokens).size, tokens.length, `tokens collided: ${tokens.join(', ')}`);
      assert.equal(
        new Set(invoices).size,
        invoices.length,
        `invoice numbers collided: ${invoices.join(', ')}`,
      );
    } finally {
      await Promise.all(clerks.map((clerk) => clerk.end()));
    }
  });

  test('transfer_visit moves the patient and retires the old token', async () => {
    const { rows } = await register(admin, {
      doctorId: FIXTURE.doctorId,
      name: 'Wrong Doctor',
      actorId,
    });
    const registered = rows[0].result;

    const moved = await admin.query(
      `select public.transfer_visit(
         p_visit_id      => $1::uuid,
         p_doctor_id     => $2::uuid,
         p_reason        => $3::text,
         p_department_id => null,
         p_hospital_id   => $4::uuid
       ) as result`,
      [
        registered.visit_id,
        FIXTURE.doctorTwoId,
        'Sent to the wrong department at the desk',
        FIXTURE.hospitalId,
      ],
    );
    const result = moved.rows[0].result;

    assert.equal(result.doctor_id, FIXTURE.doctorTwoId);
    assert.notEqual(
      result.token_no,
      registered.token_no,
      'a transferred patient takes a NEW token in the new queue',
    );

    const record = await admin.query(
      'select from_token_no, to_token_no, reason from public.visit_transfers where visit_id = $1',
      [registered.visit_id],
    );
    assert.equal(record.rows.length, 1, 'the move is on the record with its reason');
    assert.equal(record.rows[0].from_token_no, registered.token_no);
    assert.equal(record.rows[0].to_token_no, result.token_no);
  });
});

/** Row counts for everything one registration touches. */
async function counts(client) {
  const { rows } = await client.query(
    `select
       (select count(*) from public.patients     where hospital_id = $1) as patients,
       (select count(*) from public.visits       where hospital_id = $1) as visits,
       (select count(*) from public.invoices     where hospital_id = $1) as invoices,
       (select count(*) from public.charge_items where hospital_id = $1) as charges,
       (select count(*) from public.payments     where hospital_id = $1) as payments`,
    [FIXTURE.hospitalId],
  );
  return rows[0];
}

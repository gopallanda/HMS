/**
 * A throwaway hospital to run money tests against.
 *
 * These tests talk to the real Postgres, because what is being proved is a
 * property of Postgres -- row locks, transactions and visibility. A mocked
 * database would prove that the mock is well behaved and nothing else.
 *
 * Everything is created inside ONE tenant that exists for this purpose and has
 * no membership pointing at it, so nothing here is reachable from the app and
 * nothing touches the demo data in seed.sql.
 *
 * ONE tenant shared by every test FILE, which is why `npm test` passes
 * `--concurrency=1`. node --test otherwise runs files in parallel, and two
 * files both calling setUp() -- which begins with wipe() -- delete each
 * other's rows halfway through. The failure mode is not a clean red: the runs
 * block on each other's locks and produce no output at all.
 *
 * The tenant row itself is reused between runs rather than dropped, because a
 * hospital genuinely cannot be deleted: hospitals carries an AFTER DELETE audit
 * trigger, and the audit row it writes references the hospital that is being
 * removed. That is correct behaviour (CLAUDE.md 3.5 -- nothing hard-deletes),
 * so the fixture works with it instead of disabling the trigger. Every CHILD
 * row is wiped before and after each run, so the tests start from a known
 * state, including a number_series counter back at zero.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Fixed ids, so a re-run reuses the same tenant instead of adding another. */
export const FIXTURE = {
  hospitalId: '00000000-0000-4000-8000-0000000000f0',
  departmentId: '00000000-0000-4000-8000-0000000000f1',
  doctorId: '00000000-0000-4000-8000-0000000000f2',
  serviceId: '00000000-0000-4000-8000-0000000000f3',
  patientId: '00000000-0000-4000-8000-0000000000f4',
  hospitalName: 'ZZ Test Hospital (automated tests)',
  /** create_visit seeds a charge of exactly this from the doctor's fee. */
  consultationFee: 500,
  /** A second doctor, so the per-doctor token rule can be tested at all. */
  doctorTwoId: '00000000-0000-4000-8000-0000000000f5',
};

/** SUPABASE_DB_URL out of .env.local, the same file scripts/db.mjs reads. */
export function databaseUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;

  const path = resolve(ROOT, '.env.local');
  if (!existsSync(path)) return null;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*SUPABASE_DB_URL\s*=\s*(.*)$/.exec(line);
    if (match) {
      const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      return value === '' ? null : value;
    }
  }
  return null;
}

/**
 * A fresh connection. Every test here needs several: two transactions in one
 * connection are not two transactions, and the whole point is contention
 * between sessions.
 */
export async function connect(url) {
  const client = new pg.Client({
    connectionString: url,
    // Supabase serves a certificate chain Node does not ship a root for. The
    // connection is still encrypted; only the chain is unverified. This is a
    // developer machine talking to a dev project, never application code.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    // No test should ever hang the suite waiting on a lock that will not come.
    statement_timeout: 20_000,
  });
  await client.connect();
  return client;
}

/** Deletes every row this fixture owns, in foreign-key order. */
export async function wipe(client) {
  const id = FIXTURE.hospitalId;

  // payments -> invoices, charge_items -> invoices and visits, and so on. The
  // audit rows go last, because the deletes above write more of them.
  // Before invoices and visits: both hold composite FKs into them
  // (20260829090000, 20260829090200).
  await client.query('delete from public.day_closures            where hospital_id = $1', [id]);
  await client.query('delete from public.visit_payment_deferrals where hospital_id = $1', [id]);
  await client.query('delete from public.visit_transfers         where hospital_id = $1', [id]);
  await client.query('delete from public.payments      where hospital_id = $1', [id]);
  await client.query('delete from public.charge_items  where hospital_id = $1', [id]);
  await client.query('delete from public.invoices      where hospital_id = $1', [id]);
  // consultations before visits: a consultation holds a composite FK to the
  // visit it belongs to, so the visit cannot go first.
  await client.query('delete from public.consultations where hospital_id = $1', [id]);
  await client.query('delete from public.visits        where hospital_id = $1', [id]);
  await client.query('delete from public.services      where hospital_id = $1', [id]);
  await client.query('delete from public.patients      where hospital_id = $1', [id]);
  // staff_accounts before staff: the account holds a composite FK to it.
  // Nothing in these tests provisions one, but a wipe that only works when the
  // previous run happened to leave none is a wipe that fails the first time it
  // matters.
  await client.query('delete from public.staff_accounts where hospital_id = $1', [id]);
  await client.query('delete from public.staff_shifts   where hospital_id = $1', [id]);
  await client.query('delete from public.staff         where hospital_id = $1', [id]);
  await client.query('delete from public.departments   where hospital_id = $1', [id]);
  await client.query('delete from public.number_series where hospital_id = $1', [id]);
  await client.query('delete from public.audit_log     where hospital_id = $1', [id]);
}

/**
 * The tenant, a doctor with a consultation fee, a consultation service and one
 * patient. Written directly rather than through the RPCs where the RPC would
 * add nothing -- a department is not what is under test. The patient goes
 * through register_patient() because that is how an MRN is allocated.
 */
export async function setUp(client) {
  await wipe(client);

  // slug is not null and immutable (20260828090200): it is a component of every
  // synthetic staff login address, so the fixture tenant needs one of its own.
  await client.query(
    `insert into public.hospitals (id, name, slug, address, phone, gstin)
     values ($1, $2, 'zz-test-hospital', 'Nowhere', '+91 00000 00000', '29ZZZZZ0000Z1Z0')
     on conflict (id) do update set name = excluded.name`,
    [FIXTURE.hospitalId, FIXTURE.hospitalName],
  );

  // The same function a real tenant gets at provisioning, so the fixture's
  // roles cannot drift from the product's (20260828090000).
  await client.query('select public.seed_system_roles($1)', [FIXTURE.hospitalId]);

  await client.query(
    `insert into public.departments (id, hospital_id, name, code)
     values ($1, $2, 'Test Department', 'TESTDEPT')`,
    [FIXTURE.departmentId, FIXTURE.hospitalId],
  );

  // role_id, not role: staff.role is derived from it by trigger, and
  // create_visit still reads that derived value to refuse a non-doctor.
  await client.query(
    `insert into public.staff
       (id, hospital_id, full_name, role_id, department_id, consultation_fee)
     select $1, $2, 'Dr. Test', r.id, $3, $4
     from public.roles r
     where r.hospital_id = $2 and r.code = 'doctor' and r.deleted_at is null`,
    [FIXTURE.doctorId, FIXTURE.hospitalId, FIXTURE.departmentId, FIXTURE.consultationFee],
  );

  // A second doctor. Tokens are per doctor per day (20260829090000), and one
  // doctor cannot demonstrate that at all -- two patients would simply get 1
  // and 2 either way.
  await client.query(
    `insert into public.staff
       (id, hospital_id, full_name, role_id, department_id, consultation_fee)
     select $1, $2, 'Dr. Second', r.id, $3, $4
     from public.roles r
     where r.hospital_id = $2 and r.code = 'doctor' and r.deleted_at is null`,
    [FIXTURE.doctorTwoId, FIXTURE.hospitalId, FIXTURE.departmentId, FIXTURE.consultationFee],
  );

  await client.query(
    `insert into public.services (id, hospital_id, name, category, price, tax_rate)
     values ($1, $2, 'Test Consultation', 'consultation', $3, 0)`,
    [FIXTURE.serviceId, FIXTURE.hospitalId, FIXTURE.consultationFee],
  );

  await client.query(
    `select public.register_patient(jsonb_build_object(
       'id', $1::uuid,
       'hospital_id', $2::uuid,
       'full_name', 'Test Patient',
       'dob', '1990-01-01',
       'gender', 'other',
       'phone', null
     ))`,
    [FIXTURE.patientId, FIXTURE.hospitalId],
  );
}

/**
 * A visit with one pending consultation charge on it, exactly as the front
 * desk produces. Returns the visit id and the id of the charge to bill.
 */
export async function createVisit(client) {
  // Called in FROM, never as `select (create_visit(...)).*`. That second form
  // expands the composite by re-evaluating the function once per output
  // column -- one call, eleven visits -- and a fixture that quietly bills a
  // different visit than it created proves nothing about anything.
  const visit = await client.query(
    `select * from public.create_visit(jsonb_build_object(
       'hospital_id', $1::uuid,
       'patient_id',  $2::uuid,
       'doctor_id',   $3::uuid,
       'visit_type',  'opd'
     ))`,
    [FIXTURE.hospitalId, FIXTURE.patientId, FIXTURE.doctorId],
  );

  const visitId = visit.rows[0].id;

  const charge = await client.query(
    `select id from public.charge_items
      where hospital_id = $1 and visit_id = $2 and status = 'pending'`,
    [FIXTURE.hospitalId, visitId],
  );

  return { visitId, chargeIds: charge.rows.map((row) => row.id) };
}

/**
 * An auth user to record a collection against, if the project has one.
 *
 * payments.collected_by is NOT NULL (CLAUDE.md 3.2), so a test that wants to
 * insert a payment needs a real login. On a project where seed.sql has not run
 * there is none, and the tests fall back to raising the invoice unpaid --
 * which exercises the same numbering path, because the number is drawn whether
 * or not money changes hands.
 */
export async function anyAuthUser(client) {
  const result = await client.query('select id from auth.users order by created_at limit 1');
  return result.rows[0]?.id ?? null;
}

/**
 * Bill a visit. Mirrors what the Server Action sends, plus the two arguments
 * that exist only for callers with no JWT (the seed, and this).
 */
export function collectPayment(client, { visitId, chargeIds, amount = 0, collectedBy = null }) {
  return client.query(
    // In FROM, for the reason given on createVisit above -- and here it is not
    // merely wasteful: the second evaluation finds the lines it just invoiced
    // and raises 90002, so every test in the suite fails for a reason that has
    // nothing to do with the numbering being tested.
    `select * from public.collect_payment(
       p_visit_id     => $1::uuid,
       p_items        => $2::jsonb,
       p_mode         => 'cash',
       p_amount       => $3::numeric,
       p_reference    => null,
       p_invoice_id   => null,
       p_hospital_id  => $4::uuid,
       p_collected_by => $5::uuid
     )`,
    [
      visitId,
      JSON.stringify(chargeIds.map((id) => ({ charge_item_id: id }))),
      amount,
      FIXTURE.hospitalId,
      collectedBy,
    ],
  );
}

/** The tail of INV/2026-27/00042 as a number, for gap and ordering checks. */
export function invoiceSequence(invoiceNo) {
  const tail = invoiceNo.split('/').at(-1);
  return Number(tail);
}

/**
 * Waits until `pid` is parked on a lock, which is how this suite proves the
 * second collection is WAITING rather than merely slow. Returns false if it
 * never blocks.
 */
export async function waitUntilBlocked(monitor, pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await monitor.query(
      `select wait_event_type, state from pg_stat_activity where pid = $1`,
      [pid],
    );
    const row = result.rows[0];
    if (row && row.state === 'active' && row.wait_event_type === 'Lock') return true;
    await new Promise((done) => setTimeout(done, 50));
  }

  return false;
}

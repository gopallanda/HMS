/**
 * New vs Return.
 *
 * The claims under test (20260915090000):
 *
 *   A visit is new_hospital when it is the patient's first non-cancelled visit,
 *   new_doctor when the hospital knows them but this doctor does not, and
 *   repeat otherwise -- judged against the patient's WHOLE history, not just
 *   the range. "Came back" means a later IST day inside the window, and only
 *   patients whose window has passed are counted either way. A patient who did
 *   not return to their doctor but saw another one inside the window "went
 *   elsewhere". The internal classifier is not callable by a signed-in user.
 *
 * One small hospital history, built once, read by every test. Days are "days
 * ago"; the range is the last 60 days and the window 30.
 *
 *   P1  A@50  A@40  B@20     returns to A; later new to B (too recent)
 *   P2  A@55 (cancelled)  A@45      cancelled first visit does not count
 *   P3  B@48  A@44           did not return to B, went to A instead
 *   P4  A@5                  new, too recent to judge
 *   P5  A@100 (before range)  A@30  a repeat, because history counts
 *
 * Needs SUPABASE_DB_URL. Without it every test here skips rather than failing.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';

import { FIXTURE, connect, databaseUrl, setUp, wipe } from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

const A = FIXTURE.doctorId;
const B = FIXTURE.doctorTwoId;

describe('patient_mix_report', { skip, timeout: 180_000 }, () => {
  let db;
  const P = {};

  async function patient(name) {
    const id = randomUUID();
    await db.query(
      `select public.register_patient(jsonb_build_object(
         'id', $1::uuid, 'hospital_id', $2::uuid, 'full_name', $3::text,
         'dob', '1980-01-01', 'gender', 'other', 'phone', null, 'force_create', true
       ))`,
      [id, FIXTURE.hospitalId, name],
    );
    return id;
  }

  /** A back-dated visit. Completed unless told otherwise, as a past visit would be. */
  async function visit(patientId, doctorId, daysAgo, { complete = true } = {}) {
    const result = await db.query(
      `select id from public.create_visit(jsonb_build_object(
         'hospital_id', $1::uuid,
         'patient_id', $2::uuid,
         'doctor_id', $3::uuid,
         'visit_type', 'opd',
         'visited_at', now() - make_interval(days => $4::int),
         'seed_consultation', false
       ))`,
      [FIXTURE.hospitalId, patientId, doctorId, daysAgo],
    );
    const id = result.rows[0].id;
    if (complete) {
      await db.query('select public.set_visit_status($1, $2, $3)', [
        id,
        'completed',
        FIXTURE.hospitalId,
      ]);
    }
    return id;
  }

  async function report(windowDays = 30, daysBack = 60) {
    const result = await db.query(
      `select * from public.patient_mix_report(
         $1::uuid, public.ist_date(now()) - $2::int, public.ist_date(now()), $3::int
       )`,
      [FIXTURE.hospitalId, daysBack, windowDays],
    );
    return result.rows;
  }

  async function lost(doctorId) {
    const result = await db.query(
      `select * from public.patient_mix_lost_patients(
         $1::uuid, $2::uuid, public.ist_date(now()) - 60, public.ist_date(now()), 30
       )`,
      [doctorId, FIXTURE.hospitalId],
    );
    return result.rows;
  }

  const n = (value) => (value === null ? null : Number(value));

  before(async () => {
    db = await connect(url);
    await setUp(db);

    P.one = await patient('Mix One');
    P.two = await patient('Mix Two');
    P.three = await patient('Mix Three');
    P.four = await patient('Mix Four');
    P.five = await patient('Mix Five');

    await visit(P.five, A, 100);

    const cancelled = await visit(P.two, A, 55, { complete: false });
    await db.query('select public.cancel_visit($1::uuid, $2::text, $3::uuid)', [
      cancelled,
      'Patient left without waiting to be seen',
      FIXTURE.hospitalId,
    ]);

    await visit(P.one, A, 50);
    await visit(P.three, B, 48);
    await visit(P.two, A, 45);
    await visit(P.three, A, 44);
    await visit(P.one, A, 40);
    await visit(P.five, A, 30);
    await visit(P.one, B, 20);
    await visit(P.four, A, 5);
  });

  after(async () => {
    if (db) {
      await wipe(db);
      await db.end();
    }
  });

  test('the hospital summary counts new against whole history, and ignores cancellations', async () => {
    const rows = await report();
    const summary = rows.filter((row) => row.bucket === 'summary');
    assert.equal(summary.length, 1, 'exactly one summary row');
    const s = summary[0];

    assert.equal(n(s.visit_count), 8, 'the cancelled visit and the one before the range are out');
    assert.equal(n(s.patient_count), 5);
    assert.equal(n(s.new_to_hospital), 4, 'P1, P2, P3, P4 -- not P5, seen 100 days ago');
    assert.equal(n(s.new_to_doctor), 2, 'P3 with A, P1 with B');
    assert.equal(n(s.repeat_visits), 2, 'P1 back with A, P5 back with A');

    assert.equal(n(s.cohort_matured), 3, 'P4 was seen 5 days ago and is not judged yet');
    assert.equal(n(s.came_back), 2, 'P1 and P3 came back to somebody; P2 did not');
    assert.equal(n(s.median_gap_days), 15, 'gaps of 4, 10, 20 and 70 days');
  });

  test('each doctor is judged on their own first-time patients', async () => {
    const rows = await report();
    const doctorA = rows.find((row) => row.bucket === 'doctor' && row.doctor_id === A);
    const doctorB = rows.find((row) => row.bucket === 'doctor' && row.doctor_id === B);

    assert.equal(n(doctorA.visit_count), 6);
    assert.equal(n(doctorA.new_to_hospital), 3);
    assert.equal(n(doctorA.new_to_doctor), 1);
    assert.equal(n(doctorA.repeat_visits), 2);
    assert.equal(n(doctorA.cohort), 4);
    assert.equal(n(doctorA.cohort_matured), 3);
    assert.equal(n(doctorA.came_back), 1, 'only P1 came back to A');
    assert.equal(n(doctorA.went_elsewhere), 0);
    assert.equal(n(doctorA.median_gap_days), 40, 'gaps of 10 and 70 days');

    assert.equal(n(doctorB.visit_count), 2);
    assert.equal(n(doctorB.cohort), 2);
    assert.equal(n(doctorB.cohort_matured), 1, 'P1 with B is 20 days ago, window not passed');
    assert.equal(n(doctorB.came_back), 0);
    assert.equal(n(doctorB.went_elsewhere), 1, 'P3 went from B to A within the window');
  });

  test('the weeks add up to the visits', async () => {
    const rows = await report();
    const weekly = rows
      .filter((row) => row.bucket === 'week')
      .reduce((sum, row) => sum + n(row.visit_count), 0);
    assert.equal(weekly, 8);
  });

  test('the not-returned list names the right patients, most recent first', async () => {
    const forA = await lost(A);
    assert.deepEqual(
      forA.map((row) => row.patient_id),
      [P.three, P.two],
      'P3 was first seen by A 44 days ago, P2 45 days ago',
    );
    assert.equal(forA[0].new_to_hospital, false, 'P3 had already seen B');
    assert.equal(forA[1].new_to_hospital, true, 'P2 was new to the hospital');

    const forB = await lost(B);
    assert.deepEqual(
      forB.map((row) => row.patient_id),
      [P.three],
    );
    assert.equal(forB[0].seen_other_doctor, true);
  });

  test('a bad window or a range over two years is refused with a readable message', async () => {
    await assert.rejects(() => report(0), /between 1 and 365 days/);
    await assert.rejects(() => report(30, 800), /two years or less/);
  });

  test('the classifier is private; the reports are for signed-in users only', async () => {
    const privilege = async (role, signature) =>
      (
        await db.query('select has_function_privilege($1, $2, $3) as ok', [
          role,
          signature,
          'execute',
        ])
      ).rows[0].ok;

    assert.equal(
      await privilege('authenticated', 'public.patient_mix_visits(uuid,date,date,integer,uuid)'),
      false,
      'it has no permission check of its own',
    );
    assert.equal(await privilege('anon', 'public.patient_mix_report(uuid,date,date,integer)'), false);
    assert.equal(
      await privilege('authenticated', 'public.patient_mix_report(uuid,date,date,integer)'),
      true,
    );
    assert.equal(
      await privilege(
        'anon',
        'public.patient_mix_lost_patients(uuid,uuid,date,date,integer,integer)',
      ),
      false,
    );
  });
});

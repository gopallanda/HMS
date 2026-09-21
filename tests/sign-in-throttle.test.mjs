/**
 * Five guesses, however they arrive.
 *
 * The claim under test: an account is locked after MAX_FAILED_SIGN_INS wrong
 * passwords inside the window, and that is true of PARALLEL guesses as well as
 * polite sequential ones.
 *
 * It was not. lib/accounts/sign-in.ts counted failures by reading the counter
 * over PostgREST, adding one in JavaScript and writing the result back. Fifty
 * guesses opened at once each read the same zero, each computed one, and each
 * wrote one -- so locked_until was never set and the ceiling could be walked
 * straight through by anybody willing to open more than one connection. The
 * lockout worked only against an attacker who agreed to queue.
 *
 * 20260921090000 moved the arithmetic into record_failed_sign_in(), which
 * takes the row with SELECT ... FOR UPDATE. This is the test that tells the
 * two apart, and it can only be written against a real Postgres: what is being
 * proved is a property of row locks.
 *
 * Run:
 *   npm test
 *
 * Needs SUPABASE_DB_URL in .env.local. Without it every test here skips.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import { FIXTURE, anyAuthUser, connect, databaseUrl, setUp, wipe } from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

/** The constants lib/accounts/sign-in.ts exports, mirrored for the call. */
const MAX_FAILED_SIGN_INS = 5;
const FAILURE_WINDOW_MINUTES = 15;
const COOLDOWN_MINUTES = 15;

const ACCOUNT_ID = '00000000-0000-4000-8000-0000000000fa';

describe('record_failed_sign_in', { skip }, () => {
  let client;
  /** Null when the project has no auth user to hang an account off. */
  let accountReady = false;

  before(async () => {
    client = await connect(url);
    await setUp(client);

    const authUserId = await anyAuthUser(client);
    if (!authUserId) return;

    // staff_accounts.auth_user_id is unique, so the fixture borrows whichever
    // login the project already has rather than creating one. It is detached
    // again in after().
    await client.query(
      `insert into public.staff_accounts
         (id, hospital_id, staff_id, auth_user_id, login_email, contact_email,
          username, role_id, must_change_password)
       select $1, $2, s.id, $3,
              'zz.throttle@zz-test-hospital.invalid',
              'zz.throttle.contact@zz-test-hospital.invalid',
              'zz.throttle.test', s.role_id, false
       from public.staff s
       where s.id = $4`,
      [ACCOUNT_ID, FIXTURE.hospitalId, authUserId, FIXTURE.doctorId],
    );
    accountReady = true;
  });

  after(async () => {
    if (client) {
      await wipe(client);
      await client.end();
    }
  });

  /** Counters back to a clean slate, as a successful sign-in would leave them. */
  async function resetCounters() {
    await client.query(
      `update public.staff_accounts
          set failed_sign_ins = 0, first_failed_at = null, locked_until = null
        where id = $1`,
      [ACCOUNT_ID],
    );
  }

  async function readCounters() {
    const result = await client.query(
      'select failed_sign_ins, first_failed_at, locked_until from public.staff_accounts where id = $1',
      [ACCOUNT_ID],
    );
    return result.rows[0];
  }

  function recordFailure(on) {
    return on.query('select public.record_failed_sign_in($1, $2, $3, $4)', [
      ACCOUNT_ID,
      FAILURE_WINDOW_MINUTES,
      MAX_FAILED_SIGN_INS,
      COOLDOWN_MINUTES,
    ]);
  }

  test('counts sequential failures and locks on the fifth', async (t) => {
    if (!accountReady) return t.skip('no auth user on this project to attach an account to');
    await resetCounters();

    for (let attempt = 1; attempt <= MAX_FAILED_SIGN_INS; attempt += 1) {
      await recordFailure(client);
      const row = await readCounters();
      assert.equal(row.failed_sign_ins, attempt, `after attempt ${attempt}`);

      if (attempt < MAX_FAILED_SIGN_INS) {
        assert.equal(row.locked_until, null, `locked too early, at attempt ${attempt}`);
      } else {
        assert.notEqual(row.locked_until, null, 'the fifth failure must lock the account');
        assert.ok(new Date(row.locked_until) > new Date(), 'the lock must be in the future');
      }
    }
  });

  test('counts PARALLEL failures, and still locks', async (t) => {
    if (!accountReady) return t.skip('no auth user on this project to attach an account to');
    await resetCounters();

    // Twelve real connections, all firing at once. This is the shape of the
    // attack the old read-modify-write could not see: every one of these used
    // to read failed_sign_ins = 0 and write 1.
    const attackers = await Promise.all(Array.from({ length: 12 }, () => connect(url)));

    try {
      await Promise.all(attackers.map((attacker) => recordFailure(attacker)));
    } finally {
      await Promise.all(attackers.map((attacker) => attacker.end()));
    }

    const row = await readCounters();

    assert.equal(
      row.failed_sign_ins,
      12,
      'every parallel failure has to be counted, not collapsed into one',
    );
    assert.notEqual(row.locked_until, null, 'twelve failures must leave the account locked');
    assert.ok(new Date(row.locked_until) > new Date(), 'the lock must be in the future');
  });

  test('a failure outside the window starts a fresh count', async (t) => {
    if (!accountReady) return t.skip('no auth user on this project to attach an account to');
    await resetCounters();

    await recordFailure(client);
    await recordFailure(client);

    // Back-date the window so the next failure is somebody who mistypes a
    // fortnight later, not somebody attacking.
    await client.query(
      `update public.staff_accounts
          set first_failed_at = now() - make_interval(mins => $2)
        where id = $1`,
      [ACCOUNT_ID, FAILURE_WINDOW_MINUTES + 1],
    );

    await recordFailure(client);

    const row = await readCounters();
    assert.equal(row.failed_sign_ins, 1, 'the count restarts once the window has passed');
    assert.equal(row.locked_until, null, 'and a restarted count is not a lock');
  });

  test('an unknown account is silent, not an error', async (t) => {
    if (!accountReady) return t.skip('no auth user on this project to attach an account to');

    await assert.doesNotReject(() =>
      client.query('select public.record_failed_sign_in($1, $2, $3, $4)', [
        '00000000-0000-4000-8000-0000000000ff',
        FAILURE_WINDOW_MINUTES,
        MAX_FAILED_SIGN_INS,
        COOLDOWN_MINUTES,
      ]),
    );
  });
});

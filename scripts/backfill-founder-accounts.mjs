#!/usr/bin/env node
/**
 * Give every founder the staff_accounts row /signup never wrote.
 *
 *   node scripts/backfill-founder-accounts.mjs            list what would change
 *   node scripts/backfill-founder-accounts.mjs --apply    write the rows
 *
 * WHY THIS EXISTS ALONGSIDE THE SELF-HEAL
 *
 * lib/accounts/founder.ts repairs a founder on their next sign-in, which covers
 * anybody still using the product. It does not cover the hospital whose owner
 * signed in once in March and has not been back -- and that is exactly the
 * person who will one day need /forgot-password and find it silently doing
 * nothing. This walks every tenant instead of waiting for a login.
 *
 * WHY IT IS A SCRIPT AND NOT A MIGRATION
 *
 * A username has to be free across the whole DEPLOYMENT, because sign-in
 * resolves a bare username with no hospital to narrow it. That rule lives in
 * lib/credentials.ts, and this file IMPORTS it rather than restating it in SQL:
 * two implementations of how a username is built will eventually disagree, and
 * the symptom is somebody who cannot sign in while every screen looks correct.
 * Node strips the types on the way in (needs Node >= 22.18, which is what CI
 * and package.json target).
 *
 * DRY RUN BY DEFAULT. This writes to the table that decides who may sign in;
 * seeing the list first is worth one extra command.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

import {
  isSyntheticLoginEmail,
  nextFreeUsername,
  usernameStem,
} from '../lib/credentials.ts';

const ROOT = resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');

/** SUPABASE_DB_URL out of .env.local -- the same file scripts/db.mjs reads. */
function databaseUrl() {
  const path = resolve(ROOT, '.env.local');
  if (!existsSync(path)) {
    fail('.env.local not found. Copy .env.example to .env.local and fill it in.');
  }
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*SUPABASE_DB_URL\s*=\s*(.*)$/.exec(line);
    if (match) return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fail(
    'SUPABASE_DB_URL is not set in .env.local.\n' +
      '  Supabase Dashboard -> Connect -> Direct connection (or Session pooler).',
  );
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * Everybody with a login and no account row.
 *
 * The join to auth.users is what makes this a founder hunt rather than a staff
 * hunt: a desk-provisioned account always has both, so anything that turns up
 * here got its auth user from somewhere other than provisionStaffAccount().
 */
const CANDIDATES = `
  select s.id           as staff_id,
         s.hospital_id  as hospital_id,
         s.user_id      as user_id,
         s.full_name    as full_name,
         s.employee_code as employee_code,
         s.role_id      as role_id,
         s.can_login    as staff_can_login,
         r.can_login    as role_can_login,
         r.name         as role_name,
         h.name         as hospital_name,
         lower(u.email) as email
    from public.staff s
    join auth.users u        on u.id = s.user_id
    join public.roles r      on r.id = s.role_id
    join public.hospitals h  on h.id = s.hospital_id
    left join public.staff_accounts a on a.staff_id = s.id
   where s.user_id is not null
     and a.id is null
   order by h.name, s.full_name
`;

async function main() {
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();

  try {
    const { rows } = await db.query(CANDIDATES);

    if (rows.length === 0) {
      console.log('\n  Every login already has a staff_accounts row. Nothing to do.\n');
      return;
    }

    const planned = [];
    const skipped = [];
    // Usernames taken by rows already in the table PLUS ones this run has just
    // planned. Without the second half, two founders called Priya Sharma in
    // different hospitals would both be handed `priya.sharma`, and the insert
    // would fail on the second -- or worse, succeed and make a bare username
    // ambiguous at sign-in.
    const taken = new Set();
    const { rows: existing } = await db.query('select lower(username) as u from public.staff_accounts');
    for (const row of existing) taken.add(row.u);

    for (const row of rows) {
      if (!row.email) {
        skipped.push([row, 'the auth user has no email address']);
        continue;
      }
      if (isSyntheticLoginEmail(row.email)) {
        // A staff sign-in address with no account row is a provisioning that
        // rolled back, or a row somebody deleted on purpose. Recreating it here
        // would hand back access that was taken away.
        skipped.push([row, 'a staff sign-in address with no account row -- not a founder']);
        continue;
      }
      if (!row.role_can_login || row.staff_can_login === false) {
        skipped.push([row, `${row.role_name} does not sign in`]);
        continue;
      }

      const { rows: holders } = await db.query(
        `select 1 from public.staff_accounts
          where lower(login_email) = $1 or lower(contact_email) = $1 limit 1`,
        [row.email],
      );
      if (holders.length > 0) {
        skipped.push([row, `${row.email} already belongs to another account`]);
        continue;
      }

      let username;
      try {
        username = nextFreeUsername(
          usernameStem({ employeeCode: row.employee_code, fullName: row.full_name }),
          (candidate) => taken.has(candidate),
        );
      } catch (error) {
        skipped.push([row, error.message]);
        continue;
      }

      taken.add(username);
      planned.push({ ...row, username });
    }

    console.log(`\n  ${planned.length} account row(s) to write, ${skipped.length} skipped.\n`);

    for (const row of planned) {
      console.log(`  + ${row.hospital_name}: ${row.full_name} -> ${row.username} (${row.email})`);
    }
    for (const [row, why] of skipped) {
      console.log(`  - ${row.hospital_name}: ${row.full_name} skipped -- ${why}`);
    }

    if (!APPLY) {
      console.log('\n  Dry run. Re-run with --apply to write these rows.\n');
      return;
    }

    let written = 0;
    for (const row of planned) {
      try {
        // must_change_password FALSE: the founder chose this password at signup.
        // Raising it would bounce them to /change-password on the proxy gate the
        // next time they sign in, for no reason they could work out.
        await db.query(
          `insert into public.staff_accounts
             (hospital_id, staff_id, auth_user_id, login_email, contact_email,
              username, role_id, must_change_password, temp_password_issued_at, created_by)
           values ($1, $2, $3, $4, $4, $5, $6, false, null, $3)`,
          [row.hospital_id, row.staff_id, row.user_id, row.email, row.username, row.role_id],
        );
        written += 1;
      } catch (error) {
        // One tenant's problem is not the rest of them: an inactive hospital
        // trips enforce_hospital_active, and that should not stop the others.
        console.error(`  ! ${row.hospital_name}: ${row.full_name} failed -- ${error.message}`);
      }
    }

    console.log(`\n  Wrote ${written} of ${planned.length}.\n`);
  } finally {
    await db.end();
  }
}

main().catch((error) => fail(error.stack ?? String(error)));

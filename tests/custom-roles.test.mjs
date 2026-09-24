/**
 * A role a hospital invented, doing the job it was granted.
 *
 * THE BUG, from the 2026-09-23 audit
 *
 * `saveRole` leaves `roles.legacy_role` at its inert `'nurse'` default for every
 * custom role; `provisionStaffAccount` copies that onto the membership; the
 * access token hook puts it on the JWT; `app_role()` and `has_role()` read it.
 * So a hospital that created "Billing executive" and ticked billing.read and
 * billing.collect got a nurse as far as Postgres was concerned:
 *
 *   * the nav showed the screen, the proxy allowed the route,
 *     requirePermission() passed -- and then `invoices_select_billing` returned
 *     nothing and assert_billing() raised "Only billing staff can raise
 *     invoices and take payments";
 *   * while `consultations_select_clinical` and assert_clinical() both named
 *     `nurse`, so EVERY custom role satisfied the database's clinical check,
 *     including one made for housekeeping. Only the app was stopping them.
 *
 * 20260923090200 replaced the role-name predicates with has_permission() /
 * has_any_permission(), keeping is_hospital_admin() as an OR so nothing that
 * worked before narrows.
 *
 * WHAT MAKES THESE TESTS WORTH ANYTHING
 *
 * asSession() sets `request.jwt.claims` AND `set local role authenticated`.
 * Without the second half the fixture runs as the owner, which bypasses RLS
 * entirely -- so the policy assertions below would pass against the old broken
 * policies too. Every session here carries membership role 'nurse', which is
 * exactly what a custom role's JWT says.
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
  customRole,
  customStaff,
  databaseUrl,
  setUp,
  wipe,
} from './support/fixture.mjs';

const url = databaseUrl();
const skip = url
  ? false
  : 'SUPABASE_DB_URL is not set in .env.local, so there is no database to test against.';

describe('custom roles are guarded on permissions, not role names', { skip, timeout: 180_000 }, () => {
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

  /** Point the fixture's custom-role login at a role holding exactly `keys`. */
  async function become(code, name, keys) {
    const roleId = await customRole(db, { code, name, permissions: keys });
    await customStaff(db, { userId: actor, roleId, fullName: name });
    return roleId;
  }

  /**
   * Every session below claims membership role 'nurse', because that is what a
   * custom role's JWT actually carries -- legacy_role's default, copied onto the
   * membership at provisioning. Claiming 'admin' would make is_hospital_admin()
   * true and prove nothing.
   */
  function session(run) {
    return asSession(db, { userId: actor, role: 'nurse' }, run);
  }

  test('a custom billing role can raise an invoice and take a payment', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await become('billing_executive', 'Billing executive', [
      'billing.read',
      'billing.collect',
      'patients.read',
      'visits.read',
    ]);

    // The visit is set up as the owner: what is under test is the billing call,
    // not how the patient got there.
    const visit = await createVisit(db);

    // In FROM, never `select (f()).*`: that form can evaluate the function once
    // per output column, and the second evaluation finds the lines it just
    // invoiced and raises 90002. The fixture's own helper carries the same note.
    const invoice = await session((client) =>
      client
        .query(
          `select * from public.collect_payment(
             p_visit_id => $1::uuid,
             p_items    => $2::jsonb,
             p_mode     => 'cash',
             p_amount   => $3::numeric
           )`,
          [
            visit.visitId,
            JSON.stringify(visit.chargeIds.map((id) => ({ charge_item_id: id }))),
            FIXTURE.consultationFee,
          ],
        )
        .then((result) => result.rows[0]),
    );

    assert.equal(
      invoice.status,
      'paid',
      'before 20260923090200 this raised "Only billing staff can raise invoices and take payments"',
    );
    assert.equal(Number(invoice.grand_total), FIXTURE.consultationFee);
  });

  test('and can then READ the invoice it just raised', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await become('billing_executive', 'Billing executive', [
      'billing.read',
      'billing.collect',
    ]);

    const visit = await createVisit(db);
    const raised = (
      await collectPayment(db, {
        visitId: visit.visitId,
        chargeIds: visit.chargeIds,
        amount: FIXTURE.consultationFee,
        collectedBy: actor,
      })
    ).rows[0];

    const rows = await session((client) =>
      client
        .query('select id, grand_total from public.invoices where id = $1', [raised.id])
        .then((result) => result.rows),
    );

    // This is the assertion the old policy failed, and it failed SILENTLY: zero
    // rows renders as a hospital with no invoices in it rather than as a refusal.
    assert.equal(rows.length, 1, 'invoices_select_billing used to return nothing at all');
    assert.equal(Number(rows[0].grand_total), FIXTURE.consultationFee);

    const payments = await session((client) =>
      client
        .query('select amount from public.payments where invoice_id = $1', [raised.id])
        .then((result) => result.rows),
    );
    assert.equal(payments.length, 1, 'and so did payments_select_billing');
  });

  test('a custom role with no billing permission is refused, and reads nothing', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    const visit = await createVisit(db);
    const raised = (
      await collectPayment(db, {
        visitId: visit.visitId,
        chargeIds: visit.chargeIds,
        amount: FIXTURE.consultationFee,
        collectedBy: actor,
      })
    ).rows[0];

    await become('store_keeper', 'Store keeper', ['patients.read']);

    const rows = await session((client) =>
      client
        .query('select id from public.invoices where id = $1', [raised.id])
        .then((result) => result.rows),
    );
    assert.equal(rows.length, 0, 'the money stays behind a billing permission');

    const another = await createVisit(db);
    await assert.rejects(
      () =>
        session((client) =>
          client.query(
            `select * from public.collect_payment(
               p_visit_id => $1::uuid,
               p_items    => $2::jsonb,
               p_mode     => 'cash',
               p_amount   => 0
             )`,
            [
              another.visitId,
              JSON.stringify(another.chargeIds.map((id) => ({ charge_item_id: id }))),
            ],
          ),
        ),
      (error) => {
        assert.match(error.message, /do not have permission to raise invoices/);
        assert.equal(error.code, '42501');
        return true;
      },
    );
  });

  test('a custom role with no clinical permission can no longer reach the notes', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    // The tightening half of the fix. Under the old predicates this role passed
    // has_role('super_admin','admin','doctor','nurse') on its legacy default and
    // could read every consultation in the hospital; only the app said no.
    await become('store_keeper', 'Store keeper', ['patients.read']);

    const visit = await createVisit(db);
    await db.query(
      `select public.save_consultation(jsonb_build_object(
         'hospital_id', $1::uuid,
         'visit_id',    $2::uuid,
         'notes',       'Fever for three days'
       ))`,
      [FIXTURE.hospitalId, visit.visitId],
    );

    const rows = await session((client) =>
      client
        .query('select id from public.consultations where visit_id = $1', [visit.visitId])
        .then((result) => result.rows),
    );
    assert.equal(rows.length, 0, 'a store keeper has no business in a consultation');

    await assert.rejects(
      () =>
        session((client) =>
          client.query('select public.set_visit_status($1::uuid, $2, $3::uuid)', [
            visit.visitId,
            'completed',
            FIXTURE.hospitalId,
          ]),
        ),
      /do not have permission to record a consultation/,
    );
  });

  test('a custom clinical role CAN reach the notes and move the queue', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await become('ward_sister', 'Ward sister', [
      'patients.read',
      'visits.read',
      'queue.read',
      'consultation.read',
      'consultation.write',
    ]);

    const visit = await createVisit(db);
    await db.query(
      `select public.save_consultation(jsonb_build_object(
         'hospital_id', $1::uuid,
         'visit_id',    $2::uuid,
         'notes',       'Dressing change'
       ))`,
      [FIXTURE.hospitalId, visit.visitId],
    );

    const rows = await session((client) =>
      client
        .query('select notes from public.consultations where visit_id = $1', [visit.visitId])
        .then((result) => result.rows),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, 'Dressing change');

    // set_visit_status is the queue button. A custom role cannot be a visit's
    // doctor, so the has_role('doctor') ownership narrowing does not apply to
    // them -- that remains keyed on the membership role, deliberately, because
    // the right predicate for it is the roles.can_consult flag CLAUDE.md defers.
    const moved = await session((client) =>
      client
        .query('select public.set_visit_status($1::uuid, $2, $3::uuid) as payload', [
          visit.visitId,
          'completed',
          FIXTURE.hospitalId,
        ])
        .then((result) => result.rows[0].payload),
    );
    assert.equal(moved.status, 'completed');
  });

  test('a custom administration role can write the tables its keys name', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await become('practice_manager', 'Practice manager', [
      'departments.manage',
      'staff.create',
      'staff.read',
      'roster.write',
    ]);

    // departments.manage
    const department = await session((client) =>
      client
        .query(
          `insert into public.departments (hospital_id, name, code)
           values ($1, 'Physiotherapy', 'PHYSIO') returning id`,
          [FIXTURE.hospitalId],
        )
        .then((result) => result.rows[0].id),
    );
    assert.ok(department, 'departments_insert_admin used to need a membership admin role');

    // staff.create -- through the role the fixture already has, so the composite
    // FK to roles is satisfied without inventing another one.
    const doctorRole = await db
      .query(
        `select id from public.roles
          where hospital_id = $1 and code = 'doctor' and deleted_at is null`,
        [FIXTURE.hospitalId],
      )
      .then((result) => result.rows[0].id);

    const hired = await session((client) =>
      client
        .query(
          `insert into public.staff (hospital_id, full_name, role_id, department_id)
           values ($1, 'Dr. Hired By Manager', $2, $3) returning id`,
          [FIXTURE.hospitalId, doctorRole, FIXTURE.departmentId],
        )
        .then((result) => result.rows[0].id),
    );
    assert.ok(hired);

    // roster.write, including the deliberate delete that says "nothing recorded"
    await session((client) =>
      client.query(
        `insert into public.staff_shifts (hospital_id, staff_id, work_date, status, hours)
         values ($1, $2, current_date, 'scheduled', 8)`,
        [FIXTURE.hospitalId, hired],
      ),
    );
    const cleared = await session((client) =>
      client
        .query('delete from public.staff_shifts where staff_id = $1', [hired])
        .then((result) => result.rowCount),
    );
    assert.equal(cleared, 1, 'staff_shifts_delete_admin is how a roster cell is cleared');
  });

  test('a custom role without the administration keys still cannot write those tables', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await become('store_keeper', 'Store keeper', ['patients.read']);

    // RLS refuses a write the policy does not admit, which surfaces as
    // 42501 rather than as a silently skipped row.
    await assert.rejects(
      () =>
        session((client) =>
          client.query(
            `insert into public.departments (hospital_id, name, code)
             values ($1, 'Should Not Exist', 'NOPE')`,
            [FIXTURE.hospitalId],
          ),
        ),
      (error) => {
        assert.equal(error.code, '42501', 'row level security refuses it');
        return true;
      },
    );

    await assert.rejects(
      () =>
        session((client) =>
          client.query(
            `insert into public.roles (hospital_id, code, name, is_system, can_login)
             values ($1, 'self_promoted', 'Self promoted', false, true)`,
            [FIXTURE.hospitalId],
          ),
        ),
      (error) => {
        assert.equal(error.code, '42501', 'and roles.manage is not implied by anything');
        return true;
      },
    );
  });

  test('has_permission answers the same way lib/rbac/resolve.ts does', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    await become('billing_executive', 'Billing executive', ['billing.read']);

    const answers = await session((client) =>
      client
        .query(
          `select
             public.has_permission('billing.read')  as granted,
             public.has_permission('billing.void')  as not_granted,
             public.has_permission('nonsense.key')  as unknown_key,
             public.can_bill()                      as coarse_bill,
             public.can_clinical()                  as coarse_clinical`,
        )
        .then((result) => result.rows[0]),
    );

    assert.equal(answers.granted, true);
    assert.equal(answers.not_granted, false, 'a key the role does not hold is not implied');
    assert.equal(answers.unknown_key, false);
    assert.equal(answers.coarse_bill, true, 'billing.read alone opens the coarse money net');
    assert.equal(answers.coarse_clinical, false);
  });

  test('an admin membership with no staff record now holds nothing, matching fallbackAccess', async (t) => {
    if (actor === null) {
      t.skip('no auth user on this project, so there is no session to impersonate');
      return;
    }

    // has_permission's third branch used to grant EVERYTHING here, mirroring the
    // old fallbackAccess. That was narrowed to super_admin on 2026-09-23 because
    // the seeded Manager role carries legacy_role 'admin', and the two
    // implementations of one rule have to agree.
    await db.query('delete from public.staff where hospital_id = $1 and user_id = $2', [
      FIXTURE.hospitalId,
      actor,
    ]);

    const asAdmin = await asSession(db, { userId: actor, role: 'admin' }, (client) =>
      client
        .query(`select public.has_permission('settings.manage') as held`)
        .then((result) => result.rows[0].held),
    );
    assert.equal(asAdmin, false, 'an admin membership is not a permission grant');

    const asSuper = await asSession(db, { userId: actor, role: 'super_admin' }, (client) =>
      client
        .query(`select public.has_permission('settings.manage') as held`)
        .then((result) => result.rows[0].held),
    );
    assert.equal(asSuper, true, 'super_admin still overrides, because RLS opens for it anyway');
  });
});

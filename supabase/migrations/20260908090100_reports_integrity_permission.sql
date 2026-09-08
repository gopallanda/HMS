-- =============================================================================
-- 20260908090100_reports_integrity_permission.sql
-- reports.integrity becomes data.
--
-- Adding a permission is three edits (lib/rbac/permissions.ts): the key in the
-- frozen union, a PERMISSION_GROUPS entry so it appears in the role editor,
-- and a grant in public.seed_system_roles(). The first two landed with the
-- screen that guards on them. This is the third, plus the backfill.
--
--   reports.integrity   admin, manager
--
-- WHY IT IS NOT reports.view
--
-- reports.view opens the day close and the dues list: figures about the
-- hospital. This report is about PEOPLE -- it names who voided a bill, who
-- gave a concession, who took a third copy of a receipt off the printer. A
-- hospital may reasonably want its accountant reconciling the money without
-- being handed a conduct report on the counter staff, and the whole point of
-- roles being data is that it can decide that for itself.
--
-- NOT accountant, deliberately, even though reconciliation is the obvious use.
-- A new key is granted narrowly and widened by whoever runs the hospital: an
-- administrator ticks it at /admin/roles in ten seconds and no deploy, whereas
-- a key seeded onto a role by mistake has to be unticked on every tenant that
-- already has it. Narrow is the recoverable direction.
--
-- manager gets it by subtraction, as it always has: v_all minus
-- settings.manage and roles.manage. admin gets it because admin is v_all.
--
-- IDEMPOTENT, and it has to stay that way (20260828090000): re-running tops up
-- permissions the code base has since introduced and never removes one an
-- administrator unticked. The single exception is `admin`, which is re-granted
-- everything every time -- an administrator locked out of roles.manage cannot
-- let themselves back in.
--
-- Everything below is 20260902090600 unchanged except the v_all array; it is
-- repeated in full because CREATE OR REPLACE FUNCTION takes a whole body. The
-- backfill at the end is NOT unchanged -- see the note on it.
-- =============================================================================

create or replace function public.seed_system_roles(p_hospital_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   record;
  v_id     uuid;
  v_key    text;
  -- Every key in lib/rbac/permissions.ts. Kept in one place here so `admin`
  -- and `manager` are defined by subtraction rather than by a second list that
  -- would drift.
  v_all    text[] := array[
    'patients.read','patients.create','patients.update',
    'visits.create','visits.read',
    'queue.read','queue.manage','queue.cancel',
    'consultation.read','consultation.write',
    'prescription.create',
    'billing.read','billing.collect','billing.void','billing.defer',
    'billing.discount',
    'pharmacy.read','pharmacy.dispense','pharmacy.stock_adjust',
    'lab.read','lab.result_entry',
    'staff.read','staff.create','staff.update','staff.deactivate',
    'accounts.provision','accounts.reset_password',
    'roster.read','roster.write',
    'roles.manage','departments.manage',
    'settings.manage','reports.view','reports.integrity'
  ];
begin
  for v_role in
    select *
    from (
      values
        -- code, name, can_login, legacy_role, description, permissions
        (
          'admin', 'Admin', true, 'admin'::public.app_role,
          'Runs the hospital in the software. Everything.',
          v_all
        ),
        (
          'manager', 'Manager', true, 'admin'::public.app_role,
          'Runs the floor day to day. Everything except hospital settings and the roles themselves.',
          (select array_agg(k) from unnest(v_all) k
            where k not in ('settings.manage','roles.manage'))
        ),
        (
          'doctor', 'Doctor', true, 'doctor'::public.app_role,
          'Sees patients. Owns a queue and the notes on it.',
          array[
            'patients.read','visits.read','queue.read',
            'consultation.read','consultation.write','prescription.create',
            'lab.read','billing.read'
          ]
        ),
        (
          'front_desk', 'Front desk', true, 'front_desk'::public.app_role,
          'Registers patients, starts visits, takes the consultation fee.',
          array[
            'patients.read','patients.create','patients.update',
            'visits.create','visits.read',
            'queue.read','queue.manage','queue.cancel',
            'billing.read','billing.collect'
          ]
        ),
        (
          'nurse', 'Nurse', true, 'nurse'::public.app_role,
          'Vitals and queue. Reads notes, does not write them.',
          array['patients.read','visits.read','queue.read','consultation.read']
        ),
        (
          'pharmacist', 'Pharmacist', true, 'pharmacist'::public.app_role,
          'Dispenses against a prescription and takes payment for it. Phase 2.',
          array[
            'pharmacy.read','pharmacy.dispense',
            'patients.read','visits.read',
            'billing.read','billing.collect'
          ]
        ),
        (
          'lab_technician', 'Lab technician', true, 'lab_tech'::public.app_role,
          'Runs tests and enters results. Phase 2.',
          array['lab.read','lab.result_entry','patients.read']
        ),
        (
          'accountant', 'Accountant', true, 'cashier'::public.app_role,
          'Reconciles. Reads the money, voids with a reason, does not collect.',
          array['billing.read','billing.void','reports.view']
        ),
        -- Not in the prompt's table, and not optional either: `cashier` is an
        -- existing value of public.app_role and this hospital may already have
        -- staff carrying it. Without a role of the same shape the backfill
        -- below would have to demote them to accountant, which silently takes
        -- away the ability to collect a payment -- the one thing a cashier
        -- does. Noted in PROGRESS.md.
        (
          'cashier', 'Cashier', true, 'cashier'::public.app_role,
          'Sits at the billing counter. Collects, cannot void.',
          array[
            'billing.read','billing.collect','billing.discount',
            'patients.read','visits.read','queue.read'
          ]
        ),
        (
          'cleaner', 'Cleaner', false, 'nurse'::public.app_role,
          'Housekeeping. A staff record and a roster, no login.',
          array[]::text[]
        )
    ) as t(code, name, can_login, legacy_role, description, permissions)
  loop
    insert into public.roles (
      hospital_id, code, name, description, is_system, can_login, legacy_role
    )
    values (
      p_hospital_id, v_role.code, v_role.name, v_role.description,
      true, v_role.can_login, v_role.legacy_role
    )
    on conflict (hospital_id, lower(code)) where deleted_at is null
      do update set
        -- name and description are NOT overwritten: a hospital may rename its
        -- own roles. is_system and can_login are, because they are structural.
        is_system   = true,
        can_login   = excluded.can_login,
        legacy_role = excluded.legacy_role
    returning id into v_id;

    -- `admin` is re-granted everything on every run. See the header.
    if v_role.code = 'admin' then
      delete from public.role_permissions
       where role_id = v_id
         and permission_key <> all(v_all);
    end if;

    foreach v_key in array v_role.permissions loop
      insert into public.role_permissions (hospital_id, role_id, permission_key)
      values (p_hospital_id, v_id, v_key)
      on conflict (role_id, permission_key) do nothing;
    end loop;
  end loop;
end;
$$;

comment on function public.seed_system_roles(uuid) is
  'Creates or tops up the system roles for one hospital. Idempotent: adds new permissions, never removes ones an administrator unticked (except on admin).';

revoke execute on function public.seed_system_roles(uuid) from public, anon, authenticated;

-- =============================================================================
-- Backfill: every hospital that already exists gets topped up. Not a one-off
-- data migration -- seed_system_roles is called from provision_hospital(), so
-- a tenant created next year gets the key without anybody remembering to do it.
--
-- WHY THE TRIGGERS COME OFF FOR THE LENGTH OF THIS BLOCK
--
-- 20260828090000 and 20260902090600 both say a suspended tenant is seeded too,
-- because suspension means "cannot do new business", not "cannot be brought up
-- to the current schema". That was a claim about intent; it was never true.
-- roles and role_permissions carry roles_hospital_active and
-- role_permissions_hospital_active (20260828090000), enforce_hospital_active()
-- has no exemption for a migration the way assert_billing() does for a null
-- app_role(), and the re-seed is an UPDATE even when nothing changes -- so the
-- gate fires. The earlier backfills only passed because no tenant had expired
-- yet. This one did not: pushing it first failed on a hospital whose trial
-- ended today.
--
-- Leaving that hospital out was the other option and it is worse. Nothing
-- re-runs seed_system_roles when a plan is upgraded, so a tenant skipped here
-- is skipped permanently: their administrator would open /admin/roles, see the
-- new checkbox because the union is in the code, tick it, and grant a key that
-- their own Admin role never received.
--
-- So the two gates come off for this block and go straight back on. The whole
-- migration is one transaction, so a failure anywhere rolls the DISABLE back
-- with everything else and the triggers cannot be left off.
--
-- This is a workaround, not a fix. The fix is a decision about whether
-- enforce_hospital_active() should exempt a session with no app_role() -- a
-- migration, a seed, the service role -- the way every assert_* function in
-- this schema already does. That is a change to what the commercial gate
-- means and it does not belong in a report's migration. Noted in PROGRESS.md.
-- =============================================================================
alter table public.roles            disable trigger roles_hospital_active;
alter table public.role_permissions disable trigger role_permissions_hospital_active;

do $$
declare
  v_hospital_id uuid;
begin
  for v_hospital_id in select id from public.hospitals loop
    perform public.seed_system_roles(v_hospital_id);
  end loop;
end;
$$;

alter table public.roles            enable trigger roles_hospital_active;
alter table public.role_permissions enable trigger role_permissions_hospital_active;

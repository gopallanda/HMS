-- =============================================================================
-- 20260902090600_queue_cancel_and_discount_permissions.sql
-- The two new permission keys become data.
--
-- Adding a permission is three edits (lib/rbac/permissions.ts): the key in the
-- frozen union, a PERMISSION_GROUPS entry so it appears in the role editor,
-- and a grant in public.seed_system_roles(). The first two landed with the
-- code that guards on them -- a Server Action cannot compile against a key
-- that is not in the union. This is the third, plus the backfill.
--
--   queue.cancel      front_desk, admin, manager
--   billing.discount  cashier, admin, manager
--
-- NOT nurse, for either. Cancelling retires a token somebody is holding a slip
-- for and voids a bill; a concession is money the hospital chose not to take.
-- Both are decisions a hospital may want a named person to own, and the whole
-- point of splitting queue.cancel off queue.manage is that until now it could
-- not say so.
--
-- manager gets both by subtraction, as it always has: it is v_all minus
-- settings.manage and roles.manage. admin gets both because admin is v_all.
--
-- IDEMPOTENT, and it has to stay that way (20260828090000): re-running tops up
-- permissions the code base has since introduced and never removes one an
-- administrator unticked. The single exception is `admin`, which is re-granted
-- everything every time -- an administrator locked out of roles.manage cannot
-- let themselves back in.
--
-- Everything in the function below is 20260828090000 unchanged except the four
-- arrays named above; it is repeated in full because CREATE OR REPLACE
-- FUNCTION takes a whole body.
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
    'settings.manage','reports.view'
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
-- Backfill, the way 20260828090000 did it: every hospital that already exists
-- gets topped up. Not a one-off data migration -- seed_system_roles is called
-- from provision_hospital(), so a tenant created next year gets the same keys
-- without anybody remembering to do it.
--
-- A suspended tenant is seeded too. Suspension means "cannot do new business",
-- not "cannot be brought up to the current schema".
-- =============================================================================
do $$
declare
  v_hospital_id uuid;
begin
  for v_hospital_id in select id from public.hospitals loop
    perform public.seed_system_roles(v_hospital_id);
  end loop;
end;
$$;

-- =============================================================================
-- 20260828090000_roles_and_permissions.sql
-- roles + role_permissions, and the per-hospital seed that fills them.
--
-- THE DISTINCTION THIS ENCODES (PROMPT block 1.1)
--
--   Department = WHERE in the hospital somebody sits. Cardiology, Pharmacy,
--                Housekeeping. Organisational. It shows on the visit, on the
--                invoice and in reports.
--   Role       = WHAT they do, and therefore what they may open. Doctor,
--                Nurse, Front desk, Cleaner.
--
-- They are independent. A nurse in Cardiology and a nurse in Housekeeping hold
-- the same role with different departments. Nothing here derives one from the
-- other, and no permission is ever keyed off a department. That confusion is
-- the defect this table exists to end: the build had departments and no roles,
-- so a cleaner had neither.
--
-- NOT EVERY ROLE LOGS IN. roles.can_login = false is a role that has staff
-- records and a roster and no credentials at all. The manager needs a page for
-- the cleaner; the cleaner does not need an account.
--
-- WHY PERMISSIONS ARE NOT A TABLE
--
-- role_permissions.permission_key is plain text with no foreign key and no
-- enum. The list of permissions is a fact about the CODE and lives in
-- lib/rbac/permissions.ts. Storing it in Postgres would mean a migration every
-- time a screen is added, and would let an administrator tick a permission
-- nothing enforces -- which reads as access granted and behaves as access
-- denied. Unknown keys are dropped when a permission set is loaded, so a key
-- retired from the union stops having an effect without a data migration.
--
-- Roles themselves ARE data, per hospital, editable in /admin/roles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  code         text not null check (code ~ '^[a-z][a-z0-9_]{1,38}$'),
  name         text not null check (btrim(name) <> ''),
  description  text,

  -- Seeded with the hospital. Renameable -- a hospital that calls its
  -- receptionists "OPD desk" should be able to say so -- but never deletable,
  -- because the seed and the landing-page map both refer to them by code.
  is_system    boolean not null default false,

  -- false hides the credentials half of the staff form entirely. It is a
  -- property of the ROLE, copied onto the staff record at creation and
  -- overridable downwards there (a doctor who refuses to use the software).
  can_login    boolean not null default true,

  -- Compatibility shim, deliberately temporary.
  --
  -- public.app_role predates this table and is still load-bearing in two
  -- places: memberships.role, which the JWT carries and every RLS policy
  -- reads, and staff.role, which create_visit checks to refuse a "doctor" who
  -- is not one. Rather than grow that enum -- which would work against the
  -- whole point of making roles data -- each role names the legacy value its
  -- holders should carry, and a trigger keeps staff.role in step
  -- (20260828090100).
  --
  -- 'nurse' is the inert default for roles with no legacy equivalent, cleaner
  -- and every custom role included. It grants nothing: privileges come from
  -- memberships.role, never from staff.role. Block 3 makes permissions the
  -- enforcement and this column goes away with the check in create_visit.
  legacy_role  public.app_role not null default 'nurse',

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  -- lets child rows carry a composite FK that pins the tenant, the same way
  -- departments does for staff (20260818090000)
  constraint roles_hospital_id_id_key unique (hospital_id, id)
);

-- Scoped, never global (CLAUDE.md 3.1): two hospitals may both have a role
-- coded `manager`. Partial on deleted_at so a soft-deleted custom role frees
-- its code again.
create unique index roles_hospital_id_lower_code_key
  on public.roles (hospital_id, lower(code))
  where deleted_at is null;

create index roles_hospital_id_deleted_at_idx
  on public.roles (hospital_id, deleted_at);

comment on table public.roles is
  'What a person DOES, and therefore what they may open. Independent of department. Per hospital, editable without a deploy.';
comment on column public.roles.can_login is
  'false = this role does not use the software. The staff record and roster still apply; the credentials UI is hidden.';
comment on column public.roles.is_system is
  'Seeded with the hospital. Renameable, never deletable: seed_system_roles and the landing map refer to these by code.';
comment on column public.roles.legacy_role is
  'Temporary bridge to public.app_role. Grants nothing on its own -- privileges come from memberships.role. Removed in block 3.';

-- -----------------------------------------------------------------------------
-- role_permissions
--
-- The prompt sketches this with a composite primary key on
-- (role_id, permission_key). It carries a uuid id and a unique constraint on
-- that pair instead, which is the same thing functionally and buys one thing
-- that is not optional here: fn_audit() reads (row ->> 'id')::uuid, so a table
-- with no id column cannot be audited. Who granted a role the power to void
-- invoices, and when, is exactly the history CLAUDE.md 3.5 exists to keep.
--
-- hospital_id is present for the same reason it is present everywhere else
-- (CLAUDE.md 3.1, no exceptions), and the composite FK makes it impossible for
-- a permission row to drift onto a role in another tenant.
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references public.hospitals(id),
  role_id         uuid not null,
  permission_key  text not null check (permission_key ~ '^[a-z_]+\.[a-z_]+$'),
  created_at      timestamptz not null default now(),

  constraint role_permissions_role_key_key unique (role_id, permission_key),
  constraint role_permissions_role_same_hospital_fkey
    foreign key (hospital_id, role_id)
    references public.roles (hospital_id, id)
    on delete cascade
);

create index role_permissions_hospital_id_role_id_idx
  on public.role_permissions (hospital_id, role_id);

comment on table public.role_permissions is
  'Which permission keys a role holds. Keys are validated by lib/rbac/permissions.ts, not by this table -- see the migration header.';

-- -----------------------------------------------------------------------------
-- updated_at is derived, so the database keeps it
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger roles_touch_updated_at
  before update on public.roles
  for each row execute function public.touch_updated_at();

revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- =============================================================================
-- seed_system_roles(hospital_id)
--
-- Called from provision_hospital() so a NEW tenant gets its roles
-- automatically, and run below for every hospital that already exists. It is
-- not a one-off data migration: a hospital created next year needs the same
-- nine roles, and a one-off would not give them any.
--
-- Idempotent in both directions. Re-running it:
--   * re-creates a system role that is missing, by code
--   * ADDS permissions the code base has since introduced
--   * does NOT remove permissions an administrator has since unticked, and
--     does not rename a role they have renamed
--
-- That asymmetry is deliberate. A new permission should reach the roles that
-- obviously need it without anybody being asked; a permission somebody took
-- away by hand should stay away. The only exception is `admin`, which is
-- re-granted everything every time -- an administrator locked out of
-- roles.manage cannot let themselves back in, and that is a support call.
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
    'queue.read','queue.manage',
    'consultation.read','consultation.write',
    'prescription.create',
    'billing.read','billing.collect','billing.void','billing.defer',
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
            'queue.read','queue.manage',
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
            'billing.read','billing.collect',
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
-- RLS
--
-- Coarse, per CLAUDE.md 5. Every member of the hospital READS roles and their
-- permissions -- the app resolves the caller's own permission set from these
-- two tables on every request, and a policy that hid them would make the nav
-- empty for everybody. Writing is admin-only at this layer; the finer rule
-- (roles.manage) is enforced in the server actions, which is the real boundary.
--
-- No delete policy on either table. A role is retired with deleted_at
-- (CLAUDE.md 3.5); role_permissions rows genuinely are deleted when a box is
-- unticked, and that happens inside a SECURITY DEFINER function below rather
-- than from a client.
-- =============================================================================
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;

create policy roles_select_tenant on public.roles
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy roles_insert_admin on public.roles
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy roles_update_admin on public.roles
  for update to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin())
  with check (hospital_id = public.app_hospital_id());

create policy role_permissions_select_tenant on public.role_permissions
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy role_permissions_insert_admin on public.role_permissions
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy role_permissions_delete_admin on public.role_permissions
  for delete to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

-- =============================================================================
-- set_role_permissions(role_id, keys)
--
-- Replaces a role's permission list in ONE transaction. Two round trips from a
-- server action -- delete then insert -- would leave a role holding nothing if
-- the second failed, and a role holding nothing is a person who cannot work.
--
-- SECURITY DEFINER, so it does its own tenant and role checks explicitly, the
-- same way attach_staff_login does (20260825120000).
-- =============================================================================
create or replace function public.set_role_permissions(
  p_role_id uuid,
  p_keys    text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_role        public.roles;
  v_key         text;
begin
  v_hospital_id := public.app_hospital_id();

  if v_hospital_id is null or not public.is_hospital_admin() then
    raise exception 'Only an administrator can change what a role may do.'
      using errcode = '42501';
  end if;

  select r.* into v_role
  from public.roles r
  where r.id = p_role_id
    and r.hospital_id = v_hospital_id
    and r.deleted_at is null;

  if not found then
    raise exception 'That role is not in this hospital.'
      using errcode = '42501';
  end if;

  delete from public.role_permissions
   where role_id = p_role_id
     and permission_key <> all(coalesce(p_keys, array[]::text[]));

  foreach v_key in array coalesce(p_keys, array[]::text[]) loop
    insert into public.role_permissions (hospital_id, role_id, permission_key)
    values (v_hospital_id, p_role_id, v_key)
    on conflict (role_id, permission_key) do nothing;
  end loop;

  -- So the role's own updated_at moves when its permissions do. Without this,
  -- the audit trail records the permission rows changing and the role looking
  -- untouched.
  update public.roles set updated_at = now() where id = p_role_id;
end;
$$;

comment on function public.set_role_permissions(uuid, text[]) is
  'Replaces a role permission list in one transaction. Admin only, own hospital only.';

revoke execute on function public.set_role_permissions(uuid, text[]) from public, anon;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;

-- =============================================================================
-- Backfill: every hospital that already exists gets the same nine (ten) roles.
--
-- Runs BEFORE the lifecycle write-gate triggers are attached below, so a
-- suspended tenant is seeded too. Suspension means "cannot do new business",
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

-- =============================================================================
-- Audit and the tenant write gate, on both new tables.
-- =============================================================================
create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function public.fn_audit();

create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function public.fn_audit();

create trigger roles_hospital_active
  before insert or update on public.roles
  for each row execute function public.enforce_hospital_active();

create trigger role_permissions_hospital_active
  before insert or update on public.role_permissions
  for each row execute function public.enforce_hospital_active();

-- =============================================================================
-- provision_hospital(): a new tenant gets its roles with everything else.
--
-- Unchanged from 20260825090000 except for the seed_system_roles call and the
-- founder's staff row now carrying role_id. Reproduced in full rather than
-- patched, because `create or replace function` has no other form.
--
-- The founder's staff.role_id is set in 20260828090100, once that column
-- exists; this version only makes sure the roles are there to point at.
-- =============================================================================
create or replace function public.provision_hospital()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id       uuid;
  v_meta          jsonb;
  v_email         text;
  v_hospital_name text;
  v_full_name     text;
  v_hospital_id   uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'provision_hospital: not signed in'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select m.hospital_id
    into v_hospital_id
  from public.memberships m
  where m.user_id = v_user_id
    and m.is_active
  order by m.created_at
  limit 1;

  if v_hospital_id is not null then
    return v_hospital_id;
  end if;

  select u.raw_user_meta_data, u.email
    into v_meta, v_email
  from auth.users u
  where u.id = v_user_id;

  v_hospital_name := nullif(btrim(coalesce(v_meta ->> 'hospital_name', '')), '');
  v_full_name     := nullif(btrim(coalesce(v_meta ->> 'full_name', '')), '');

  if v_hospital_name is null then
    return null;
  end if;

  insert into public.hospitals (name)
  values (v_hospital_name)
  returning id into v_hospital_id;

  -- Before the membership and the staff row, because both of them now want a
  -- role to point at.
  perform public.seed_system_roles(v_hospital_id);

  insert into public.memberships (user_id, hospital_id, role, is_active)
  values (v_user_id, v_hospital_id, 'admin', true);

  insert into public.staff (hospital_id, user_id, full_name, role)
  values (
    v_hospital_id,
    v_user_id,
    coalesce(v_full_name, v_email, 'Administrator'),
    'admin'
  );

  return v_hospital_id;
end;
$$;

comment on function public.provision_hospital() is
  'Self-serve tenant creation. Creates a hospital, its system roles, an admin membership and a staff row for the calling user. Idempotent.';

revoke execute on function public.provision_hospital() from public, anon;
grant execute on function public.provision_hospital() to authenticated;

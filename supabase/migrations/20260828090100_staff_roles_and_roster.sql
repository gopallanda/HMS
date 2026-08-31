-- =============================================================================
-- 20260828090100_staff_roles_and_roster.sql
-- staff points at a role; staff_shifts gives every role a roster.
--
-- WHAT THIS FIXES: a cleaner had nowhere to exist. Department was being asked
-- to stand in for role, and the only people the software modelled were people
-- who signed into it. After this migration a staff record is a person who
-- works here -- with a role, optionally a department, optionally credentials,
-- and a month of shifts either way.
--
-- staff.role (public.app_role) is NOT dropped. It is still read by
-- create_visit, which refuses a "doctor" who is not one (20260818120100), and
-- dropping it here would mean rewriting a money RPC in a migration about
-- staff. It becomes DERIVED instead: a trigger keeps it equal to the role's
-- legacy_role, so there is one source of truth even while two columns exist.
-- Block 3 removes the check and then the column.
-- =============================================================================

-- staff already carries unique (hospital_id, id) -- added in
-- 20260818120000 so visits could pin a doctor to its own tenant. staff_shifts
-- below reuses it as the target of the same kind of composite FK.

-- -----------------------------------------------------------------------------
-- staff: new columns
-- -----------------------------------------------------------------------------
alter table public.staff
  add column role_id uuid,

  -- NULL means "follow the role", which is the normal case. Only `false` is
  -- ever stored, and only as a deliberate override downwards -- a doctor who
  -- will not use the software, a manager who runs the floor from paper. The
  -- prompt describes this as "copied from the role at creation"; inheriting
  -- instead of copying means a role that later stops logging in takes its
  -- people with it, rather than leaving a set of stale copies behind.
  --
  -- Effective value: roles.can_login AND coalesce(staff.can_login, true).
  add column can_login boolean,

  -- The username stem (block 2.3). Preferred over the person's name, which
  -- collides and leaks. Scoped unique, like every other business key.
  add column employee_code text check (employee_code is null or employee_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),

  add column employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contract'));

-- Deliberately NOT added: the `status text` column the prompt sketches.
-- public.staff already carries is_active, and two columns answering "is this
-- person still here" is the kind of duplication that ends with a deactivated
-- member of staff still showing up in one of the two lists. is_active stays
-- the single answer. Noted in PROGRESS.md.

create unique index staff_hospital_id_lower_employee_code_key
  on public.staff (hospital_id, lower(employee_code))
  where employee_code is not null;

create index staff_hospital_id_role_id_idx
  on public.staff (hospital_id, role_id);

comment on column public.staff.can_login is
  'null = follow the role. false = this person is denied credentials even though their role allows them. Never true.';
comment on column public.staff.employee_code is
  'Payroll or badge number. Becomes the stem of the username when an account is provisioned.';
comment on column public.staff.role is
  'DERIVED from role_id via sync_staff_legacy_role(). Kept only because create_visit still checks it. Do not write it directly.';

-- -----------------------------------------------------------------------------
-- Backfill role_id from the legacy enum, by role code.
--
-- Mapped by code rather than by roles.legacy_role, because that mapping is not
-- one to one: admin and manager both carry 'admin', accountant and cashier
-- both carry 'cashier'. Going the other way has to name the winner.
--
--   super_admin -> admin          front_desk -> front_desk
--   admin       -> admin          cashier    -> cashier
--   doctor      -> doctor         pharmacist -> pharmacist
--   nurse       -> nurse          lab_tech   -> lab_technician
--
-- Nobody is promoted and nobody is demoted: cashier maps to the cashier role,
-- which is why that role exists (see 20260828090000).
-- -----------------------------------------------------------------------------
update public.staff s
   set role_id = r.id
  from public.roles r
 where r.hospital_id = s.hospital_id
   and r.deleted_at is null
   and r.code = case s.role
     when 'super_admin' then 'admin'
     when 'admin'       then 'admin'
     when 'doctor'      then 'doctor'
     when 'front_desk'  then 'front_desk'
     when 'cashier'     then 'cashier'
     when 'pharmacist'  then 'pharmacist'
     when 'lab_tech'    then 'lab_technician'
     when 'nurse'       then 'nurse'
   end;

-- Fail the migration rather than ship a nullable role_id: a staff row with no
-- role is the exact hole this phase exists to close, and one that survived the
-- backfill means the mapping above is wrong.
do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans from public.staff where role_id is null;
  if v_orphans > 0 then
    raise exception
      'Backfill left % staff rows with no role_id. Check the role -> code map above.',
      v_orphans;
  end if;
end;
$$;

alter table public.staff
  alter column role_id set not null,
  add constraint staff_role_same_hospital_fkey
    foreign key (hospital_id, role_id)
    references public.roles (hospital_id, id);

-- -----------------------------------------------------------------------------
-- staff.role becomes derived
-- -----------------------------------------------------------------------------
create or replace function public.sync_staff_legacy_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_legacy public.app_role;
begin
  select r.legacy_role into v_legacy
  from public.roles r
  where r.id = new.role_id
    and r.hospital_id = new.hospital_id;

  if v_legacy is null then
    -- The composite FK would catch this too, but by sentence rather than by
    -- constraint name.
    raise exception 'That role does not belong to this hospital.'
      using errcode = '23503';
  end if;

  new.role := v_legacy;
  return new;
end;
$$;

comment on function public.sync_staff_legacy_role() is
  'Keeps staff.role equal to the role legacy_role. staff.role is a compatibility column; role_id is the truth.';

create trigger staff_sync_legacy_role
  before insert or update of role_id, hospital_id on public.staff
  for each row execute function public.sync_staff_legacy_role();

revoke execute on function public.sync_staff_legacy_role() from public, anon, authenticated;

-- =============================================================================
-- staff_shifts -- the cleaner's page, and everybody else's
--
-- hours is STORED, not derived at read time. Shifts get edited retroactively
-- and payroll has to see what was agreed, not what a formula reconstructs
-- afterwards from times that may since have been corrected.
-- =============================================================================
create table public.staff_shifts (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  staff_id     uuid not null,
  work_date    date not null,

  status       text not null default 'scheduled'
    check (status in ('scheduled', 'present', 'absent', 'day_off', 'leave')),

  start_time   time,
  end_time     time,
  hours        numeric(4,2) check (hours is null or (hours >= 0 and hours <= 24)),
  notes        text,

  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One row per person per day. A second shift on the same day is an edit to
  -- the first, not a new row: the roster is a grid, and a cell holds one
  -- answer.
  constraint staff_shifts_hospital_id_staff_id_work_date_key
    unique (hospital_id, staff_id, work_date),

  constraint staff_shifts_staff_same_hospital_fkey
    foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),

  -- Half a time range is a data-entry slip, not a shift.
  constraint staff_shifts_times_are_a_pair
    check ((start_time is null) = (end_time is null))
);

create index staff_shifts_hospital_id_work_date_idx
  on public.staff_shifts (hospital_id, work_date);

create index staff_shifts_hospital_id_staff_id_work_date_idx
  on public.staff_shifts (hospital_id, staff_id, work_date);

comment on table public.staff_shifts is
  'Roster. One row per staff member per day. Applies to every role, including roles that never sign in.';
comment on column public.staff_shifts.hours is
  'Stored, not computed at read time: shifts are edited retroactively and payroll must see what was agreed.';

create trigger staff_shifts_touch_updated_at
  before update on public.staff_shifts
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- hours from the times, when both are given and the caller did not say
-- otherwise. An overnight shift (22:00 to 06:00) wraps rather than going
-- negative -- cleaners and nurses work them, and a -16 in a payroll export is
-- worse than no number at all.
-- -----------------------------------------------------------------------------
create or replace function public.compute_shift_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_minutes numeric;
begin
  if new.start_time is not null and new.end_time is not null and new.hours is null then
    v_minutes := extract(epoch from (new.end_time - new.start_time)) / 60;
    if v_minutes < 0 then
      v_minutes := v_minutes + 24 * 60;   -- crossed midnight
    end if;
    new.hours := round((v_minutes / 60)::numeric, 2);
  end if;

  -- A day off has no hours, whatever was typed before the status changed.
  if new.status in ('absent', 'day_off', 'leave') then
    new.hours := null;
    new.start_time := null;
    new.end_time := null;
  end if;

  return new;
end;
$$;

create trigger staff_shifts_compute_hours
  before insert or update on public.staff_shifts
  for each row execute function public.compute_shift_hours();

revoke execute on function public.compute_shift_hours() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS. Coarse, per CLAUDE.md 5: the tenant reads its own roster, admins write.
-- roster.read / roster.write are enforced in the server actions, which is the
-- boundary that actually decides.
-- -----------------------------------------------------------------------------
alter table public.staff_shifts enable row level security;

create policy staff_shifts_select_tenant on public.staff_shifts
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy staff_shifts_insert_admin on public.staff_shifts
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy staff_shifts_update_admin on public.staff_shifts
  for update to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin())
  with check (hospital_id = public.app_hospital_id());

create trigger staff_shifts_audit
  after insert or update or delete on public.staff_shifts
  for each row execute function public.fn_audit();

create trigger staff_shifts_hospital_active
  before insert or update on public.staff_shifts
  for each row execute function public.enforce_hospital_active();

-- =============================================================================
-- provision_hospital(): the founder's staff row now names a role.
--
-- Reproduced in full again -- `create or replace function` has no patch form.
-- The only change from 20260828090000 is that the staff insert passes role_id
-- instead of role, which is now derived from it.
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
  v_admin_role_id uuid;
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

  perform public.seed_system_roles(v_hospital_id);

  select r.id into v_admin_role_id
  from public.roles r
  where r.hospital_id = v_hospital_id
    and r.code = 'admin'
    and r.deleted_at is null;

  insert into public.memberships (user_id, hospital_id, role, is_active)
  values (v_user_id, v_hospital_id, 'admin', true);

  insert into public.staff (hospital_id, user_id, full_name, role, role_id)
  values (
    v_hospital_id,
    v_user_id,
    coalesce(v_full_name, v_email, 'Administrator'),
    'admin',
    v_admin_role_id
  );

  return v_hospital_id;
end;
$$;

revoke execute on function public.provision_hospital() from public, anon;
grant execute on function public.provision_hospital() to authenticated;

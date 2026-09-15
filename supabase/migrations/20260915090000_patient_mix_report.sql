-- =============================================================================
-- 20260915090000_patient_mix_report.sql
-- New vs Return: which patients are new, which come back, and to whom.
--
-- The paper register at a clinic has an N or an R written beside every name,
-- from memory. This system does not ask anybody to write it: every visit
-- already carries patient_id, doctor_id and visited_at, so whether a visit is
-- somebody's first is a fact the database can work out -- and a derived answer
-- stays right when a first visit is later cancelled, where a stored flag would
-- go stale. No column is added to visits or patients.
--
-- DEFINITIONS -- one place, public.patient_mix_visits(), used by both reports
--
--   new_hospital   the patient's first visit here that was not cancelled
--   new_doctor     seen here before, but never by THIS doctor
--   repeat         seen by this doctor before
--
--   Cancelled visits do not exist for this report. A soft-deleted patient is
--   left out. A transferred visit belongs to the doctor it ended with -- the
--   first doctor never saw the patient. An emergency visit with no doctor
--   counts in the hospital figures and in no doctor's row.
--
--   came back      a first visit with a doctor (or with the hospital) followed
--                  by another visit on a LATER IST day, within the window. A
--                  second visit the same day is a patient bringing back a
--                  report, not a patient who returned.
--   matured        the window has fully passed. A patient first seen five days
--                  ago cannot have "come back within 30 days" yet, and counting
--                  them as not-returned would make every recent month look like
--                  a retention collapse.
--   went elsewhere a first visit with this doctor, no return to them within the
--                  window, and a visit with a different doctor inside it.
--
-- WHO MAY SEE IT
--
-- reports.patients, a new key, admin only by default. The report puts a doctor's
-- name next to how many of their patients did not come back, and a doctor who
-- holds reports.view for the day close should not be reading their colleagues'
-- figures. Manager is excluded by subtraction, for the reason 20260908090100
-- gives: narrow is the recoverable direction, and an administrator can tick it
-- for a Manager at /admin/roles in ten seconds.
--
-- The patient list under a doctor additionally needs patients.read: it carries
-- names and mobile numbers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- seed_system_roles: 20260908090100 unchanged except `reports.patients` in
-- v_all and in the Manager subtraction. Repeated in full because CREATE OR
-- REPLACE FUNCTION takes a whole body.
-- -----------------------------------------------------------------------------
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
    'settings.manage','reports.view','reports.integrity','reports.patients'
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
            where k not in ('settings.manage','roles.manage','reports.patients'))
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
        is_system   = true,
        can_login   = excluded.can_login,
        legacy_role = excluded.legacy_role
    returning id into v_id;

    -- `admin` is re-granted everything on every run (20260828090000).
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

-- Backfill. The two lifecycle gates come off for the length of the block, for
-- the reason 20260908090100 records at length; the migration is one
-- transaction, so they cannot be left off.
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

-- =============================================================================
-- patient_mix_visits(hospital, from, to, window, doctor?) -- INTERNAL
--
-- One row per non-cancelled visit in the IST range, classified. Both public
-- reports aggregate or filter this and nothing else, so "new" cannot come to
-- mean two things on two screens.
--
-- Classification needs each patient's WHOLE history, not just the range -- a
-- visit on the first day of the range is only "new" if there was nothing
-- before it. So the window functions run over every earlier visit of the
-- patients who appear in the range, and only those patients: that keeps the
-- scan proportional to the range rather than to the life of the hospital.
-- visits_hospital_id_patient_id_visited_at_idx (20260818120000) serves both the
-- history and the came-back probes.
--
-- SECURITY INVOKER and executable by nobody but the owner: it has no
-- permission check of its own, so it is reachable only through the two
-- SECURITY DEFINER functions below that do.
-- =============================================================================
create or replace function public.patient_mix_visits(
  p_hospital_id  uuid,
  p_from         date,
  p_to           date,
  p_window_days  integer,
  p_doctor_id    uuid default null
)
returns table (
  visit_id              uuid,
  patient_id            uuid,
  doctor_id             uuid,
  visited_at            timestamptz,
  visit_day             date,
  kind                  text,
  first_with_doctor     boolean,
  matured               boolean,
  gap_same_doctor_days  integer,
  gap_any_days          integer,
  came_back_same        boolean,
  came_back_any         boolean,
  seen_other_doctor     boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today   date := public.ist_date(now());
  v_from_at timestamptz;
  v_to_at   timestamptz;
begin
  if p_hospital_id is null or p_from is null or p_to is null or p_window_days is null then
    raise exception 'patient_mix_visits needs a hospital, a date range and a window.'
      using errcode = '22023';
  end if;

  if p_to - p_from > 731 then
    raise exception 'Choose a range of two years or less.'
      using errcode = '22023';
  end if;

  if p_window_days < 1 or p_window_days > 365 then
    raise exception 'The return window must be between 1 and 365 days.'
      using errcode = '22023';
  end if;

  v_from_at := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to_at   := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  return query
  with scope as (
    select distinct v.patient_id
    from public.visits v
    where v.hospital_id = p_hospital_id
      and v.status <> 'cancelled'
      and v.visited_at >= v_from_at
      and v.visited_at <  v_to_at
      and (p_doctor_id is null or v.doctor_id = p_doctor_id)
  ),
  history as (
    select
      v.id,
      v.patient_id,
      v.doctor_id,
      v.visited_at,
      public.ist_date(v.visited_at)                      as visit_day,
      row_number() over w_patient                        as nth_hospital,
      row_number() over w_doctor                         as nth_doctor,
      public.ist_date(lag(v.visited_at) over w_patient)  as prev_any_day,
      public.ist_date(lag(v.visited_at) over w_doctor)   as prev_same_day
    from public.visits v
    join scope s
      on s.patient_id = v.patient_id
    join public.patients p
      on p.hospital_id = v.hospital_id
     and p.id = v.patient_id
     and p.deleted_at is null
    where v.hospital_id = p_hospital_id
      and v.status <> 'cancelled'
      and v.visited_at < v_to_at
    window
      w_patient as (partition by v.patient_id order by v.visited_at, v.id),
      w_doctor  as (partition by v.patient_id, v.doctor_id order by v.visited_at, v.id)
  ),
  marked as (
    select
      h.*,
      (h.doctor_id is not null and h.nth_doctor = 1)  as is_first_with_doctor,
      (h.visit_day + p_window_days < v_today)         as is_matured
    from history h
    where h.visited_at >= v_from_at
      and (p_doctor_id is null or h.doctor_id = p_doctor_id)
  )
  select
    m.id,
    m.patient_id,
    m.doctor_id,
    m.visited_at,
    m.visit_day,
    case
      when m.nth_hospital = 1   then 'new_hospital'
      when m.is_first_with_doctor then 'new_doctor'
      else 'repeat'
    end,
    m.is_first_with_doctor,
    m.is_matured,
    m.visit_day - m.prev_same_day,
    m.visit_day - m.prev_any_day,
    -- The three probes run only for the rows that need them (CASE does not
    -- evaluate a branch it does not take), and each looks FORWARD past p_to:
    -- a patient first seen on the last day of the range who returned the
    -- following week did come back.
    case when m.is_first_with_doctor and m.is_matured then exists (
      select 1 from public.visits n
      where n.hospital_id = p_hospital_id
        and n.patient_id  = m.patient_id
        and n.doctor_id   = m.doctor_id
        and n.status     <> 'cancelled'
        and n.visited_at >= (m.visit_day + 1)::timestamp at time zone 'Asia/Kolkata'
        and n.visited_at <  (m.visit_day + p_window_days + 1)::timestamp at time zone 'Asia/Kolkata'
    ) end,
    case when m.nth_hospital = 1 and m.is_matured then exists (
      select 1 from public.visits n
      where n.hospital_id = p_hospital_id
        and n.patient_id  = m.patient_id
        and n.status     <> 'cancelled'
        and n.visited_at >= (m.visit_day + 1)::timestamp at time zone 'Asia/Kolkata'
        and n.visited_at <  (m.visit_day + p_window_days + 1)::timestamp at time zone 'Asia/Kolkata'
    ) end,
    case when m.is_first_with_doctor and m.is_matured then exists (
      select 1 from public.visits n
      where n.hospital_id = p_hospital_id
        and n.patient_id  = m.patient_id
        and n.doctor_id is distinct from m.doctor_id
        and n.doctor_id is not null
        and n.status     <> 'cancelled'
        and n.visited_at >= (m.visit_day + 1)::timestamp at time zone 'Asia/Kolkata'
        and n.visited_at <  (m.visit_day + p_window_days + 1)::timestamp at time zone 'Asia/Kolkata'
    ) end
  from marked m;
end;
$$;

comment on function public.patient_mix_visits(uuid, date, date, integer, uuid) is
  'Internal. Every non-cancelled visit in an IST range, classified new_hospital / new_doctor / repeat, with came-back outcomes. The single definition behind patient_mix_report and patient_mix_lost_patients.';

revoke execute on function public.patient_mix_visits(uuid, date, date, integer, uuid)
  from public, anon, authenticated;

-- =============================================================================
-- patient_mix_report(hospital, from, to, window)
--
-- One flat table with a `bucket` discriminator, the shape day_close_report and
-- cash_integrity_report use, so the screen makes one round trip and the tiles,
-- the doctor table and the weekly chart describe the same moment.
--
--   summary  exactly one row, even over an empty range
--   doctor   one row per doctor with a visit in the range
--   week     one row per ISO week (Monday) with a visit in the range
-- =============================================================================
create or replace function public.patient_mix_report(
  p_hospital_id  uuid    default null,
  p_from         date    default null,
  p_to           date    default null,
  p_window_days  integer default 30
)
returns table (
  bucket           text,
  doctor_id        uuid,
  doctor_name      text,
  department_name  text,
  week_start       date,
  visit_count      bigint,
  patient_count    bigint,
  new_to_hospital  bigint,
  new_to_doctor    bigint,
  repeat_visits    bigint,
  cohort           bigint,
  cohort_matured   bigint,
  came_back        bigint,
  went_elsewhere   bigint,
  median_gap_days  numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hospital_id uuid;
  v_from        date;
  v_to          date;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);

  -- THE boundary. SECURITY DEFINER is what lets one function read visits,
  -- staff and departments regardless of the caller's own policies, which means
  -- RLS is not the guard here and this check is (CLAUDE.md 3.6). A null
  -- app_role() is no session: service role, seed, tests.
  if public.app_role() is not null
     and not public.has_permission('reports.patients') then
    raise exception 'Your role is not allowed to open the New vs Return report (reports.patients).'
      using errcode = '42501';
  end if;

  -- Ninety days ending today by default. A range typed backwards is a slip at
  -- the date input, so it is swapped rather than refused.
  v_to   := coalesce(p_to, public.ist_date(now()));
  v_from := coalesce(p_from, v_to - 89);
  select least(v_from, v_to), greatest(v_from, v_to) into v_from, v_to;

  return query
  with m as materialized (
    select *
    from public.patient_mix_visits(v_hospital_id, v_from, v_to, coalesce(p_window_days, 30))
  )
  select
    'summary'::text,
    null::uuid,
    null::text,
    null::text,
    null::date,
    count(*),
    count(distinct m.patient_id),
    count(*) filter (where m.kind = 'new_hospital'),
    count(*) filter (where m.kind = 'new_doctor'),
    count(*) filter (where m.kind = 'repeat'),
    -- The hospital's cohort is its new patients, and "came back" means to
    -- anybody at all.
    count(*) filter (where m.kind = 'new_hospital'),
    count(*) filter (where m.kind = 'new_hospital' and m.matured),
    count(*) filter (where m.came_back_any),
    null::bigint,
    round((percentile_cont(0.5) within group (order by m.gap_any_days)
           filter (where m.gap_any_days > 0))::numeric, 1)
  from m

  union all

  select
    'doctor',
    m.doctor_id,
    s.full_name::text,
    d.name::text,
    null,
    count(*),
    count(distinct m.patient_id),
    count(*) filter (where m.kind = 'new_hospital'),
    count(*) filter (where m.kind = 'new_doctor'),
    count(*) filter (where m.kind = 'repeat'),
    -- A doctor's cohort is everybody seeing them for the first time, whether
    -- or not the hospital had seen them before.
    count(*) filter (where m.first_with_doctor),
    count(*) filter (where m.first_with_doctor and m.matured),
    count(*) filter (where m.came_back_same),
    count(*) filter (where m.came_back_same is false and m.seen_other_doctor),
    round((percentile_cont(0.5) within group (order by m.gap_same_doctor_days)
           filter (where m.gap_same_doctor_days > 0))::numeric, 1)
  from m
  join public.staff s
    on s.hospital_id = v_hospital_id
   and s.id = m.doctor_id
  left join public.departments d
    on d.hospital_id = s.hospital_id
   and d.id = s.department_id
  group by m.doctor_id, s.full_name, d.name

  union all

  select
    'week',
    null,
    null,
    null,
    date_trunc('week', m.visit_day::timestamp)::date,
    count(*),
    count(distinct m.patient_id),
    count(*) filter (where m.kind = 'new_hospital'),
    count(*) filter (where m.kind = 'new_doctor'),
    count(*) filter (where m.kind = 'repeat'),
    null,
    null,
    null,
    null,
    null
  from m
  group by date_trunc('week', m.visit_day::timestamp)::date;
end;
$$;

comment on function public.patient_mix_report(uuid, date, date, integer) is
  'New vs Return over an IST date range: one summary row, one row per doctor, one row per week. Needs reports.patients.';

revoke execute on function public.patient_mix_report(uuid, date, date, integer) from public, anon;
grant execute on function public.patient_mix_report(uuid, date, date, integer) to authenticated;

-- =============================================================================
-- patient_mix_lost_patients(doctor, hospital, from, to, window, limit)
--
-- The people behind one doctor's "did not come back" figure: patients seeing
-- that doctor for the first time in the range, whose window has passed, with
-- no return visit to them inside it. Names and mobile numbers, so a hospital
-- can ring them -- which is why it needs patients.read on top of
-- reports.patients.
-- =============================================================================
create or replace function public.patient_mix_lost_patients(
  p_doctor_id    uuid,
  p_hospital_id  uuid    default null,
  p_from         date    default null,
  p_to           date    default null,
  p_window_days  integer default 30,
  p_limit        integer default 200
)
returns table (
  patient_id         uuid,
  mrn                text,
  full_name          text,
  phone              text,
  first_visit_at     timestamptz,
  new_to_hospital    boolean,
  seen_other_doctor  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hospital_id uuid;
  v_from        date;
  v_to          date;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);

  if public.app_role() is not null
     and not (public.has_permission('reports.patients')
              and public.has_permission('patients.read')) then
    raise exception 'Listing these patients needs reports.patients and patients.read.'
      using errcode = '42501';
  end if;

  if p_doctor_id is null then
    raise exception 'Choose a doctor.' using errcode = '22023';
  end if;

  v_to   := coalesce(p_to, public.ist_date(now()));
  v_from := coalesce(p_from, v_to - 89);
  select least(v_from, v_to), greatest(v_from, v_to) into v_from, v_to;

  return query
  select
    m.patient_id,
    p.mrn::text,
    p.full_name::text,
    p.phone::text,
    m.visited_at,
    m.kind = 'new_hospital',
    coalesce(m.seen_other_doctor, false)
  from public.patient_mix_visits(
         v_hospital_id, v_from, v_to, coalesce(p_window_days, 30), p_doctor_id
       ) m
  join public.patients p
    on p.hospital_id = v_hospital_id
   and p.id = m.patient_id
  where m.first_with_doctor
    and m.matured
    and m.came_back_same is false
  order by m.visited_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

comment on function public.patient_mix_lost_patients(uuid, uuid, date, date, integer, integer) is
  'One doctor''s new patients in an IST range who did not come back to them within the window. Needs reports.patients and patients.read.';

revoke execute on function public.patient_mix_lost_patients(uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.patient_mix_lost_patients(uuid, uuid, date, date, integer, integer) to authenticated;

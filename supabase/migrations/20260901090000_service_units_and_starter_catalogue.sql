-- =============================================================================
-- 20260901090000_service_units_and_starter_catalogue.sql
--
-- Two changes to the charge master, both aimed at the same misreading.
--
-- WHY
--
-- `services` is a catalogue of individually priced LINE ITEMS, and `category`
-- is the folder they sit in -- not a rate for the folder. A hospital that lands
-- on an empty price list, opens the dialog and sees six categories concludes
-- the opposite: that it is being asked for "the lab price" and "the bed price".
-- That misreading survives until the first bill is wrong.
--
--   1. seed_starter_services() gives a new tenant ~30 real rows, so the shape
--      of the table is visible before anybody types anything. provision_hospital
--      calls it, exactly as it already calls seed_system_roles().
--
--   2. services.unit says what one of something IS. Until now that meaning was
--      smuggled into the name -- 'General Ward - per day' -- which is free text
--      nothing can enforce. When Phase 3 multiplies a bed rate by length of
--      stay, a row that says 1500 and means per-day has to be distinguishable
--      from a row that says 1500 and means once, in a column, not in prose.
--
-- Deliberately NOT here: pharmacy rows. A drug price belongs to a batch
-- (CLAUDE.md 3.4), so a fixed price on a molecule is a price that is wrong
-- within a month. The enum label stays -- charge_items.source_module reporting
-- needs it and existing rows carry it -- but the starter list ships none, and
-- the admin screen stops offering it on new rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- service_unit
--
-- Five values, chosen because each one changes how a quantity is READ at the
-- counter, not to describe the world exhaustively. `each` is the default and
-- covers most of an OPD day.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_unit') then
    create type public.service_unit as enum (
      'each', 'per_day', 'per_test', 'per_session', 'per_hour'
    );
  end if;
end;
$$;

alter table public.services
  add column if not exists unit public.service_unit not null default 'each';

comment on column public.services.unit is
  'What one of this IS: each / per day / per test / per session / per hour. Display-only in Phase 1; load-bearing when IPD accrues a bed charge per night (CLAUDE.md 4, Phase 3).';

-- Backfill by category. Beds are billed per night everywhere; a lab row is one
-- test. Everything else stays `each`, which is what the default already gave
-- it. Written as an update rather than left to the admin: 'General Ward - per
-- day' already SAYS per day, and asking somebody to retype what the row states
-- is how a backfill gets half-done.
update public.services set unit = 'per_day'  where category = 'bed' and unit = 'each';
update public.services set unit = 'per_test' where category = 'lab' and unit = 'each';

-- =============================================================================
-- seed_starter_services(hospital_id, only_when_empty)
--
-- The tariff a 20-100 bed hospital in India actually raises bills for. Prices
-- are PLACEHOLDERS -- plausible, never authoritative -- and every screen that
-- offers this says so. The point is the shape: three consultation lines, nine
-- procedures, eleven tests, four ward classes. An owner who sees eleven named
-- lab tests never again asks what "the lab price" is.
--
-- Two callers, two modes:
--
--   * provision_hospital(), with only_when_empty = true. A new tenant gets the
--     list; a hospital that already priced its own work is left alone.
--   * the admin screen's "standard price list" button, with false. That one is
--     a deliberate act by somebody looking at the catalogue, and it tops up:
--     rows whose name already exists are skipped, so no price is ever
--     overwritten and nothing is duplicated.
--
-- Never removes, never re-prices, never reactivates. A service taken off the
-- list stays off -- the conflict target sees the row regardless of is_active.
--
-- Not granted to authenticated, exactly like seed_system_roles. The server
-- action reaches it with the service role after checking settings.manage,
-- which is the real boundary (CLAUDE.md 3.6).
-- =============================================================================
create or replace function public.seed_starter_services(
  p_hospital_id     uuid,
  p_only_when_empty boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_hospital_id is null then
    raise exception 'seed_starter_services: hospital_id is required';
  end if;

  if p_only_when_empty
     and exists (select 1 from public.services s where s.hospital_id = p_hospital_id)
  then
    return 0;
  end if;

  with starter (name, category, unit, price) as (
    values
      -- Consultation. The price here is advisory: staff.consultation_fee wins
      -- on a visit, and both the SQL comment on services.price and the admin
      -- screen say so.
      ('Consultation - OPD',            'consultation', 'each',        500.00),
      ('Consultation - Follow up',      'consultation', 'each',        200.00),
      ('Consultation - After hours',    'consultation', 'each',        800.00),

      -- Procedures: what a nurse or doctor DOES, billed alongside the consult.
      -- In a small hospital this is a third of the day's collection.
      ('Injection - IM / IV',           'procedure',    'each',        100.00),
      ('Dressing - small',              'procedure',    'each',        200.00),
      ('Dressing - large',              'procedure',    'each',        400.00),
      ('Nebulisation',                  'procedure',    'per_session', 250.00),
      ('ECG',                           'procedure',    'each',        300.00),
      ('Suturing - minor',              'procedure',    'each',        800.00),
      ('Plaster (POP) application',     'procedure',    'each',       1200.00),
      ('Catheterisation',               'procedure',    'each',        600.00),
      ('Oxygen',                        'procedure',    'per_hour',    300.00),

      -- Lab. Eleven rows, because "the lab" is never one price.
      ('Complete Blood Count (CBC)',    'lab',          'per_test',    350.00),
      ('Haemoglobin',                   'lab',          'per_test',    100.00),
      ('Blood Sugar - Fasting',         'lab',          'per_test',    120.00),
      ('Blood Sugar - Random',          'lab',          'per_test',    120.00),
      ('Blood Group and Rh',            'lab',          'per_test',    150.00),
      ('Urine Routine',                 'lab',          'per_test',    200.00),
      ('Widal Test',                    'lab',          'per_test',    300.00),
      ('Dengue NS1',                    'lab',          'per_test',    900.00),
      ('Lipid Profile',                 'lab',          'per_test',    700.00),
      ('Liver Function Test (LFT)',     'lab',          'per_test',    800.00),
      ('Thyroid Profile (T3 T4 TSH)',   'lab',          'per_test',    600.00),

      -- Beds: one row per ward class, each per night. Phase 3 accrues against
      -- these; the unit is why it can.
      ('General Ward',                  'bed',          'per_day',    1500.00),
      ('Semi-private Room',             'bed',          'per_day',    3000.00),
      ('Private Room',                  'bed',          'per_day',    4500.00),
      ('ICU',                           'bed',          'per_day',    8000.00),

      -- Everything a hospital charges for that is not clinical.
      ('Ambulance - local',             'other',        'each',        800.00),
      ('Medical certificate',           'other',        'each',        200.00),
      ('Case record copy',              'other',        'each',        100.00)
  )
  insert into public.services (hospital_id, name, category, unit, price, tax_rate, is_active)
  select
    p_hospital_id,
    s.name,
    s.category::public.service_category,
    s.unit::public.service_unit,
    s.price,
    -- Zero across the board. Hospital services are largely GST-exempt
    -- (CLAUDE.md 8), and there is no pharmacy row here to be the exception.
    0.00,
    true
  from starter s
  on conflict (hospital_id, lower(name)) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.seed_starter_services(uuid, boolean) is
  'Starter charge master for one hospital: ~30 placeholder-priced rows across consultation, procedure, lab, bed and other. Adds only what is missing; never re-prices, removes or reactivates. No pharmacy rows -- a drug price belongs to a batch.';

revoke execute on function public.seed_starter_services(uuid, boolean) from public, anon, authenticated;

-- =============================================================================
-- provision_hospital(): a new tenant gets a price list with everything else.
--
-- Full body again; the only change from 20260828090200 is the
-- seed_starter_services call beside the seed_system_roles one.
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
  v_base          text;
  v_slug          text;
  v_n             int := 1;
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

  v_base := pg_catalog.left(coalesce(public.slugify(v_hospital_name), 'hospital'), 34);
  v_slug := v_base;
  while exists (select 1 from public.hospitals h where h.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;

  insert into public.hospitals (name, slug)
  values (v_hospital_name, v_slug)
  returning id into v_hospital_id;

  perform public.seed_system_roles(v_hospital_id);

  -- The price list, for the same reason as the roles: a module that opens
  -- empty is a module nobody can tell the purpose of.
  perform public.seed_starter_services(v_hospital_id, true);

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

-- =============================================================================
-- Hospitals that already exist and never got a price list.
--
-- only_when_empty, so a hospital that has priced anything at all is untouched.
-- The same reasoning as the seed_system_roles backfill: a tenant provisioned
-- last week needs this as much as one provisioned tomorrow.
-- =============================================================================
do $$
declare
  v_hospital record;
begin
  for v_hospital in select id from public.hospitals loop
    perform public.seed_starter_services(v_hospital.id, true);
  end loop;
end;
$$;

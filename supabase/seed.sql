-- =============================================================================
-- seed.sql -- demo data. Run with `npm run db:seed` (hosted project, no Docker).
--
-- Creates: one hospital, three departments, the ten system roles, seven staff
-- across six of them -- two of whom never sign in -- a fortnight of the
-- cleaners' roster, and a super_admin login that can sign in immediately.
--
-- Safe to run repeatedly. Every row has a fixed UUID and an ON CONFLICT guard,
-- so a second run adds nothing and overwrites nothing you have since edited in
-- the admin screens -- which matters, because the login step at the bottom may
-- need a re-run.
--
-- Phase 1 adds the charge master, 20 patients, a queue of 10 visits dated the
-- day the seed is run, five invoices raised against that queue -- one of them
-- part paid and one voided -- and a consultation for every visit that is past
-- the waiting stage, so the billing and doctor screens both open with
-- something other than zeroes.
--
-- It also back-dates five earlier visits, with notes, across three of those
-- patients. That is what gives the patient record a history to show: Arjun
-- Reddy ends up with three visits, real consultation notes and the part-paid
-- invoice, which is the record worth opening in a demo.
--
-- Runs as the postgres role: RLS does not apply, and the audit rows it writes
-- carry actor_id null.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The hospital
-- -----------------------------------------------------------------------------
-- plan and status are spelled out rather than left to their defaults: the
-- column default is 'trial', and a demo hospital that quietly expires after
-- fourteen days would look like a bug in the seed rather than the feature
-- working (20260825140000).
-- slug is spelled out rather than derived, and it is not decoration: it is the
-- middle of every synthetic staff login address (20260828090200), so the demo
-- hospital's usernames resolve to sunrise@sunrise-multispeciality-hospital...
-- and stay stable across re-seeds. It is immutable once set.
insert into public.hospitals (id, name, slug, address, phone, gstin, settings, plan, status)
values (
  '00000000-0000-4000-8000-000000000001',
  'Sunrise Multispeciality Hospital',
  'sunrise-multispeciality-hospital',
  '14 MG Road, Indiranagar, Bengaluru 560038',
  '+91 80 4123 5566',
  '29ABCDE1234F1Z5',
  jsonb_build_object('receipt_default', 'thermal_80mm'),
  'standard',
  'active'
)
on conflict (id) do nothing;

-- Reactivate on every run. This is the one thing the seed deliberately DOES
-- overwrite: a demo hospital left suspended from testing the block would make
-- every later run of this file fail on the insert trigger, with an error about
-- suspension rather than about anything the seed did.
update public.hospitals
   set plan = 'standard', status = 'active'
 where id = '00000000-0000-4000-8000-000000000001'
   and (plan <> 'standard' or status <> 'active');

-- -----------------------------------------------------------------------------
-- Departments. Three clinical departments -- front desk and billing staff sit
-- in none, which is the normal shape and exercises the nullable
-- staff.department_id.
-- -----------------------------------------------------------------------------
insert into public.departments (id, hospital_id, name, code) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'General Medicine', 'GENMED'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Orthopaedics',     'ORTHO'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Paediatrics',      'PAED')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Roles.
--
-- Not written out row by row: seed_system_roles() is what a real hospital gets
-- at provisioning (20260828090000), so the demo hospital gets exactly the same
-- ten roles from exactly the same function. A hand-written list here would be a
-- second definition, and the day it drifted the seed would be demonstrating
-- something the product does not do.
--
-- Idempotent, like everything else in this file.
-- -----------------------------------------------------------------------------
select public.seed_system_roles('00000000-0000-4000-8000-000000000001');

-- -----------------------------------------------------------------------------
-- Staff. Seven people across six roles -- and two of them never sign in.
--
-- Sunita Devi and Ravi Naik, both Cleaners, are the point of this list. Their
-- role has can_login = false, so the credentials half of the staff form
-- disappears for them entirely; what they have instead is a staff record and a
-- roster. Before the phase 1 remediation there was nowhere in this product for
-- either of them to exist.
--
-- user_id stays null here: a staff record exists before a login does
-- (CLAUDE.md 4). The block at the bottom attaches the one login this seed
-- creates.
--
-- staff.role is deliberately absent from the column list. It is derived from
-- role_id by trigger (20260828090100), so writing it would be writing a value
-- the database is about to overwrite.
--
-- Only the doctors carry a consultation fee. Three different fees, because
-- Phase 1 seeds the consultation charge_item from this column and a flat rate
-- would hide a bug there.
-- -----------------------------------------------------------------------------
insert into public.staff
  (id, hospital_id, full_name, role_id, department_id, phone, reg_no,
   consultation_fee, employee_code, employment_type)
select v.id, v.hospital_id, v.full_name, r.id, v.department_id, v.phone, v.reg_no,
       v.consultation_fee, v.employee_code, v.employment_type
from (values
  ('00000000-0000-4000-8000-000000000201'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Dr. Anjali Rao',    'doctor',     '00000000-0000-4000-8000-000000000101'::uuid, '+91 98450 11223', 'KMC/2011/45231', 500.00, 'EMP0001', 'full_time'),
  ('00000000-0000-4000-8000-000000000202'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Dr. Vikram Shetty', 'doctor',     '00000000-0000-4000-8000-000000000102'::uuid, '+91 98450 11224', 'KMC/2008/33110', 700.00, 'EMP0002', 'full_time'),
  ('00000000-0000-4000-8000-000000000203'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Dr. Meera Nair',    'doctor',     '00000000-0000-4000-8000-000000000103'::uuid, '+91 98450 11225', 'KMC/2015/61802', 450.00, 'EMP0003', 'part_time'),
  ('00000000-0000-4000-8000-000000000204'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Lakshmi Prasad',    'front_desk', null,                                         '+91 98450 11226', null,             0,      'EMP0004', 'full_time'),
  ('00000000-0000-4000-8000-000000000205'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Ramesh Kumar',      'cashier',    null,                                         '+91 98450 11227', null,             0,      'EMP0005', 'full_time'),
  ('00000000-0000-4000-8000-000000000206'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Sunita Devi',       'cleaner',    null,                                         '+91 98450 11228', null,             0,      'EMP0006', 'full_time'),
  ('00000000-0000-4000-8000-000000000207'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'Ravi Naik',         'cleaner',    null,                                         '+91 98450 11229', null,             0,      'EMP0007', 'contract')
) as v(id, hospital_id, full_name, role_code, department_id, phone, reg_no,
       consultation_fee, employee_code, employment_type)
join public.roles r
  on r.hospital_id = v.hospital_id
 and r.code = v.role_code
 and r.deleted_at is null
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- A fortnight of the cleaners' roster, ending yesterday.
--
-- This is block 1's acceptance criterion written as data: two people with no
-- credentials, and a fortnight of days somebody had to be able to record for
-- them. Sundays are days off, and one day in the middle is an absence, so the
-- grid shows more than one state and the hours column is not simply days x 8.
-- -----------------------------------------------------------------------------
insert into public.staff_shifts
  (hospital_id, staff_id, work_date, status, start_time, end_time)
select
  '00000000-0000-4000-8000-000000000001',
  s.staff_id,
  d.work_date::date,
  case
    when extract(dow from d.work_date) = 0 then 'day_off'
    when d.work_date::date = public.ist_date(now()) - 3
     and s.staff_id = '00000000-0000-4000-8000-000000000206'::uuid then 'absent'
    else 'present'
  end,
  case when extract(dow from d.work_date) = 0 then null else s.start_time end,
  case when extract(dow from d.work_date) = 0 then null else s.end_time end
from (values
  ('00000000-0000-4000-8000-000000000206'::uuid, time '06:00', time '14:00'),
  ('00000000-0000-4000-8000-000000000207'::uuid, time '14:00', time '22:00')
) as s(staff_id, start_time, end_time)
cross join generate_series(
  (public.ist_date(now()) - 14)::timestamp,
  (public.ist_date(now()) - 1)::timestamp,
  interval '1 day'
) as d(work_date)
on conflict (hospital_id, staff_id, work_date) do nothing;

-- =============================================================================
-- The super_admin login
--
-- Attached to Dr. Anjali Rao: in a hospital this size the owner is usually one
-- of the doctors, and it makes the staff-record-versus-login distinction
-- visible in the UI (her row shows the key icon).
--
-- Her STAFF role stays 'doctor' -- that is her job. Her MEMBERSHIP role is
-- 'super_admin' -- that is what her token carries and what RLS reads
-- (CLAUDE.md 5). The two are deliberately not the same field.
--
-- Creating an auth user from SQL means writing into GoTrue's own tables, which
-- is not a supported API. It works, and it saves a manual step on every fresh
-- environment, but if GoTrue's schema ever moves the insert fails -- so it is
-- wrapped, and the failure prints the dashboard steps instead of aborting the
-- seed.
--
--   email:    admin@sunrise.test
--   password: Sunrise@123          <- demo only. Change it before anyone real
--                                     logs in, and never reuse it in staging.
-- =============================================================================
do $$
declare
  v_hospital_id uuid := '00000000-0000-4000-8000-000000000001';
  v_staff_id    uuid := '00000000-0000-4000-8000-000000000201';
  v_user_id     uuid := '00000000-0000-4000-8000-0000000000a1';
  v_email       text := 'admin@sunrise.test';
  v_password    text := 'Sunrise@123';
  v_existing    uuid;
  v_pgcrypto    text;
  v_hashed      text;
begin
  select id into v_existing from auth.users where email = v_email limit 1;

  if v_existing is null then
    begin
      -- pgcrypto lives in `extensions` on a hosted project and in `public` on
      -- some self-hosted ones. Resolve it rather than guessing.
      select n.nspname into v_pgcrypto
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pgcrypto';

      if v_pgcrypto is null then
        raise exception 'pgcrypto is not installed, cannot hash a password';
      end if;

      execute format('select %I.crypt($1, %I.gen_salt(''bf''))', v_pgcrypto, v_pgcrypto)
        into v_hashed
        using v_password;

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        -- GoTrue reads these as non-null strings. Left null, sign-in fails with
        -- a scan error rather than a useful message.
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token,
        reauthentication_token
      )
      values (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
        v_email, v_hashed, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', 'Dr. Anjali Rao'),
        now(), now(),
        '', '', '', '', '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      )
      values (
        gen_random_uuid(), v_user_id, v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
        'email', now(), now(), now()
      );

      v_existing := v_user_id;
      raise notice 'seed: created login % (password %)', v_email, v_password;

    exception when others then
      raise notice 'seed: could not create the auth user (%).', sqlerrm;
      raise notice 'seed: create it by hand -- Dashboard -> Authentication -> Add user, email %, tick Auto Confirm User, then run npm run db:seed again.', v_email;
    end;
  else
    raise notice 'seed: login % already exists, password left alone', v_email;
  end if;

  if v_existing is null then
    return;
  end if;

  -- Converges on re-run: this is the one thing that must end up correct even
  -- if the user was created by hand between two seed runs.
  insert into public.memberships (user_id, hospital_id, role)
  values (v_existing, v_hospital_id, 'super_admin')
  on conflict (user_id, hospital_id) do update
    set role = excluded.role, is_active = true;

  update public.staff
     set user_id = v_existing
   where id = v_staff_id
     and user_id is distinct from v_existing;

  raise notice 'seed: super_admin membership attached for %', v_email;
  raise notice 'seed: the access token hook must be enabled in Dashboard -> Authentication -> Hooks, or every sign-in reports a missing hospital claim';
end;
$$;

-- =============================================================================
-- Services -- the charge master.
--
-- created_at is set explicitly and spread apart, because create_visit picks
-- the hospital's default consultation service as the FIRST one it created
-- (order by created_at, name). Inserted in one statement they would all share
-- the transaction timestamp, and the tie-break on name would quietly make
-- "Consultation - Follow up" the default.
--
-- Tax rates are per service, never per invoice (CLAUDE.md 8): every clinical
-- service here is GST-exempt at 0, and the one pharmacy line is not.
-- =============================================================================
insert into public.services (id, hospital_id, name, category, unit, price, tax_rate, created_at) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'Consultation - OPD',          'consultation', 'each',  500.00,  0.00, now() - interval '60 minutes'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', 'Consultation - Follow up',    'consultation', 'each',  200.00,  0.00, now() - interval '59 minutes'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', 'Dressing',                    'procedure', 'each',     300.00,  0.00, now() - interval '58 minutes'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', 'Nebulisation',                'procedure', 'per_session',     250.00,  0.00, now() - interval '57 minutes'),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', 'ECG',                         'procedure', 'each',     400.00,  0.00, now() - interval '56 minutes'),
  ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000001', 'Complete Blood Count',        'lab', 'per_test',           350.00,  0.00, now() - interval '55 minutes'),
  ('00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000001', 'Blood Sugar - Fasting',       'lab', 'per_test',           120.00,  0.00, now() - interval '54 minutes'),
  ('00000000-0000-4000-8000-000000000408', '00000000-0000-4000-8000-000000000001', 'Urine Routine',               'lab', 'per_test',           200.00,  0.00, now() - interval '53 minutes'),
  ('00000000-0000-4000-8000-000000000409', '00000000-0000-4000-8000-000000000001', 'General Ward - per day',      'bed', 'per_day',          1500.00,  0.00, now() - interval '52 minutes'),
  ('00000000-0000-4000-8000-00000000040a', '00000000-0000-4000-8000-000000000001', 'Semi-private Room - per day', 'bed', 'per_day',          3000.00,  0.00, now() - interval '51 minutes'),
  ('00000000-0000-4000-8000-00000000040b', '00000000-0000-4000-8000-000000000001', 'Paracetamol 650mg - strip',   'pharmacy', 'each',       30.00, 12.00, now() - interval '50 minutes'),
  ('00000000-0000-4000-8000-00000000040c', '00000000-0000-4000-8000-000000000001', 'Ambulance - local',           'other', 'each',         800.00,  0.00, now() - interval '49 minutes')
on conflict (id) do nothing;

-- =============================================================================
-- Patients
--
-- Registered through register_patient(), not with a plain insert: the seed
-- should exercise the same path the front desk does, so MRNs come out of
-- number_series and a mistake in the RPC shows up here rather than in the
-- hospital.
--
-- Idempotent on the fixed ids -- register_patient returns the existing row
-- instead of allocating a second MRN.
--
-- The spread is deliberate. There is an infant (age renders in months), two
-- children, two people over 75, a leap-day birthday, one patient with no phone
-- at all, and a mother and daughter who share one mobile -- which is why
-- register_patient has force_create, and why the last of the two passes it.
-- =============================================================================
do $$
declare
  v_hospital uuid := '00000000-0000-4000-8000-000000000001';
  r record;
begin
  for r in
    select * from (values
      ('00000000-0000-4000-8000-000000000301'::uuid, 'Ramesh Gowda',      '1968-03-12'::date, 'male',   '+91 98860 22101', '42 4th Cross, Jayanagar, Bengaluru',        false),
      ('00000000-0000-4000-8000-000000000302'::uuid, 'Sunita Devi',       '1985-07-30'::date, 'female', '+91 98860 22102', '7 Kaveri Layout, Banashankari, Bengaluru',  false),
      ('00000000-0000-4000-8000-000000000303'::uuid, 'Arjun Reddy',       '1994-11-05'::date, 'male',   '+91 98860 22103', '18 HSR Layout Sector 2, Bengaluru',         false),
      ('00000000-0000-4000-8000-000000000304'::uuid, 'Fatima Begum',      '1979-01-22'::date, 'female', '+91 98860 22104', '3 Tannery Road, Bengaluru',                 false),
      ('00000000-0000-4000-8000-000000000305'::uuid, 'Kiran Kumar',       '2001-06-18'::date, 'male',   '+91 98860 22105', '90 Rajajinagar 2nd Block, Bengaluru',       false),
      ('00000000-0000-4000-8000-000000000306'::uuid, 'Lakshmi Narayanan', '1956-09-09'::date, 'female', '+91 98860 22106', '11 Malleswaram 8th Cross, Bengaluru',       false),
      ('00000000-0000-4000-8000-000000000307'::uuid, 'Prakash Jain',      '1972-12-01'::date, 'male',   '+91 98860 22107', '25 Chickpet, Bengaluru',                    false),
      ('00000000-0000-4000-8000-000000000308'::uuid, 'Anita Fernandes',   '1990-04-14'::date, 'female', '+91 98860 22108', '6 Richards Town, Bengaluru',                false),
      ('00000000-0000-4000-8000-000000000309'::uuid, 'Mohammed Irfan',    '1988-08-25'::date, 'male',   '+91 98860 22109', '54 Shivajinagar, Bengaluru',                false),
      ('00000000-0000-4000-8000-00000000030a'::uuid, 'Deepa Shetty',      '1996-02-29'::date, 'female', '+91 98860 22110', '31 Koramangala 5th Block, Bengaluru',       false),
      ('00000000-0000-4000-8000-00000000030b'::uuid, 'Aarav Nayak',       '2025-11-02'::date, 'male',   '+91 98860 22111', '8 Vijayanagar, Bengaluru',                  false),
      ('00000000-0000-4000-8000-00000000030c'::uuid, 'Vikram Singh',      '1965-05-19'::date, 'male',   '+91 98860 22112', '77 Domlur, Bengaluru',                      false),
      ('00000000-0000-4000-8000-00000000030d'::uuid, 'Kavita Rao',        '1983-10-11'::date, 'female', '+91 98860 22113', '19 Basavanagudi, Bengaluru',                false),
      ('00000000-0000-4000-8000-00000000030e'::uuid, 'Suresh Babu',       '1959-07-07'::date, 'male',   '+91 98860 22114', '2 Yelahanka New Town, Bengaluru',           false),
      -- Same mobile as her mother, Kavita Rao. force_create answers the
      -- duplicate-phone question the way the desk would.
      ('00000000-0000-4000-8000-00000000030f'::uuid, 'Nandini Rao',       '2019-03-21'::date, 'female', '+91 98860 22113', '19 Basavanagudi, Bengaluru',                true),
      ('00000000-0000-4000-8000-000000000310'::uuid, 'Joseph Mathew',     '1975-06-30'::date, 'male',   '+91 98860 22115', '14 Cooke Town, Bengaluru',                  false),
      ('00000000-0000-4000-8000-000000000311'::uuid, 'Rekha Sharma',      '1992-09-16'::date, 'female', '+91 98860 22116', '63 Indiranagar 12th Main, Bengaluru',       false),
      -- No mobile. The phone column is nullable, and search has to cope.
      ('00000000-0000-4000-8000-000000000312'::uuid, 'Ganesh Prabhu',     '1948-02-08'::date, 'male',   null,              '5 Srirampuram, Bengaluru',                  false),
      ('00000000-0000-4000-8000-000000000313'::uuid, 'Shalini Menon',     '1987-12-24'::date, 'female', '+91 98860 22117', '48 Whitefield, Bengaluru',                  false),
      ('00000000-0000-4000-8000-000000000314'::uuid, 'Imran Khan',        '2013-01-17'::date, 'male',   '+91 98860 22118', '22 Frazer Town, Bengaluru',                 false)
    ) as t(id, full_name, dob, gender, phone, address, force_create)
  loop
    perform public.register_patient(jsonb_build_object(
      'id',           r.id,
      'hospital_id',  v_hospital,
      'full_name',    r.full_name,
      'dob',          r.dob,
      'gender',       r.gender,
      'phone',        r.phone,
      'address',      r.address,
      'force_create', r.force_create
    ));
  end loop;

  raise notice 'seed: 20 sample patients present';
end;
$$;

-- =============================================================================
-- Earlier visits -- so a patient record has a history rather than one line.
--
-- The patient record screen (/patients/[id]) is a timeline, a billing panel and
-- a list of consultation notes. With only today's queue seeded, every patient
-- in the demo has exactly one visit and no notes at all, which is the one shape
-- that makes a timeline look like a bug.
--
-- Three patients get a past between three weeks and four months ago, and each
-- of those visits carries the vitals and the note a doctor actually wrote.
-- Arjun Reddy is deliberately one of them: his is the visit today's billing
-- block leaves PART PAID, so his record is the demo that shows a real history
-- above a non-zero outstanding balance.
--
-- seed_consultation is false here on purpose. A consultation charge raised on a
-- visit four months ago and still sitting unbilled would be a debt this
-- hospital never chased, and the honest alternative -- an invoice dated back to
-- the visit -- is not on offer: collect_payment stamps invoice_date itself, and
-- the seed is not going to reach past an RPC and rewrite a money column to make
-- a demo look tidier (CLAUDE.md 3.2). These are visits that were settled before
-- this system existed.
--
-- Idempotent on "does this hospital have any visit before today". Unlike the
-- queue below, this block must NOT reproduce itself tomorrow -- yesterday's
-- seeded queue is already a history by then.
--
-- Back-dating is a service-role privilege that create_visit only grants when
-- there is no JWT claim, which is exactly the case here.
-- =============================================================================
do $$
declare
  v_hospital uuid := '00000000-0000-4000-8000-000000000001';
  v_visit    public.visits;
  v_ids      uuid[] := '{}';
  r          record;
begin
  if exists (
    select 1 from public.visits v
    where v.hospital_id = v_hospital
      and public.ist_date(v.visited_at) < public.ist_date(now())
  ) then
    raise notice 'seed: this hospital already has visits before today, history left alone';
    return;
  end if;

  for r in
    select * from (values
      -- Arjun Reddy: the knee, twice. Same doctor both times.
      ('00000000-0000-4000-8000-000000000303'::uuid, '00000000-0000-4000-8000-000000000202'::uuid,
       112, 128, 82, 76, 98.4, 74.5, 98,
       'Right knee pain after a fall on the stairs, three days.' || chr(10) ||
       'Mild effusion, full range of movement, no bony tenderness.' || chr(10) ||
       'Impression: soft tissue injury.' || chr(10) ||
       'Advice: rest, ice, analgesia. Review in two weeks if not settling.'),
      ('00000000-0000-4000-8000-000000000303'::uuid, '00000000-0000-4000-8000-000000000202'::uuid,
       63, 124, 80, 72, 98.2, 75.0, 99,
       'Review. Knee much improved, occasional ache after long standing.' || chr(10) ||
       'No swelling today.' || chr(10) || 'Advice: resume normal activity, quadriceps exercises.'),
      -- Ramesh Gowda: a diabetic follow-up, which is what an OPD sees most of.
      ('00000000-0000-4000-8000-000000000301'::uuid, '00000000-0000-4000-8000-000000000201'::uuid,
       97, 148, 92, 84, 98.6, 81.2, 97,
       'Type 2 diabetes, on metformin. Reports good compliance.' || chr(10) ||
       'BP raised today; no headache, no visual disturbance.' || chr(10) ||
       'Advice: repeat BP in two weeks, reduce salt, continue current dose.'),
      ('00000000-0000-4000-8000-000000000301'::uuid, '00000000-0000-4000-8000-000000000201'::uuid,
       21, 138, 86, 80, 98.4, 80.4, 98,
       'BP better on repeat. Continues metformin.' || chr(10) ||
       'Advice: continue, review in three months.'),
      -- Kavita Rao: one earlier visit, and vitals taken with no note written --
      -- the shape the record has when a nurse saw the patient and the doctor
      -- did not get to the notes. The panel has to read correctly for it.
      ('00000000-0000-4000-8000-00000000030d'::uuid, '00000000-0000-4000-8000-000000000203'::uuid,
       41, 118, 76, 88, 99.1, 58.0, 99, null)
    ) as t(patient_id, doctor_id, days_ago, bp_systolic, bp_diastolic, pulse,
           temperature_f, weight_kg, spo2, notes)
    order by days_ago desc
  loop
    v_visit := public.create_visit(jsonb_build_object(
      'hospital_id',       v_hospital,
      'patient_id',        r.patient_id,
      'doctor_id',         r.doctor_id,
      'visit_type',        'opd',
      'visited_at',        now() - make_interval(days => r.days_ago),
      'seed_consultation', false
    ));

    v_ids := v_ids || v_visit.id;

    perform public.save_consultation(jsonb_build_object(
      'hospital_id',   v_hospital,
      'visit_id',      v_visit.id,
      'bp_systolic',   r.bp_systolic,
      'bp_diastolic',  r.bp_diastolic,
      'pulse',         r.pulse,
      'temperature_f', r.temperature_f,
      'weight_kg',     r.weight_kg,
      'spo2',          r.spo2,
      'notes',         r.notes,
      -- Every one of them is over and done with. A past visit still reading
      -- "waiting" would put five ghosts at the top of a queue history, and
      -- save_consultation is the one path allowed to move a visit's status.
      'visit_status',  'completed'
    ));
  end loop;

  raise notice 'seed: % earlier visits with notes, for the patient record', array_length(v_ids, 1);
end;
$$;

-- =============================================================================
-- Today's queue -- 10 visits, created through create_visit() so each one gets
-- a real visit number, the next queue token, and a consultation charge seeded
-- from that doctor's own fee.
--
-- Idempotent differently from everything above: the visit ids are NOT fixed.
-- The queue screen shows TODAY, so a seed re-run tomorrow has to produce
-- today's visits or the screen is empty. The guard is therefore "does this
-- hospital already have visits today", not "does this id exist" -- run it
-- twice on one day and nothing happens; run it again tomorrow and there is a
-- fresh queue.
-- =============================================================================
do $$
declare
  v_hospital  uuid := '00000000-0000-4000-8000-000000000001';
  v_day_start timestamptz;
  v_at        timestamptz;
  v_visit     public.visits;
  v_ids       uuid[] := '{}';
  r record;
begin
  if exists (
    select 1 from public.visits v
    where v.hospital_id = v_hospital
      and public.ist_date(v.visited_at) = public.ist_date(now())
  ) then
    raise notice 'seed: this hospital already has visits today, queue left alone';
    return;
  end if;

  -- Midnight tonight-in-IST, as an absolute moment. Slots hang off it.
  v_day_start := (public.ist_date(now())::timestamp) at time zone 'Asia/Kolkata';

  for r in
    select * from (values
      (1,  '00000000-0000-4000-8000-000000000301'::uuid, '00000000-0000-4000-8000-000000000201'::uuid, 'opd',       interval '9 hours 5 minutes'),
      (2,  '00000000-0000-4000-8000-00000000030d'::uuid, '00000000-0000-4000-8000-000000000203'::uuid, 'opd',       interval '9 hours 20 minutes'),
      (3,  '00000000-0000-4000-8000-00000000030f'::uuid, '00000000-0000-4000-8000-000000000203'::uuid, 'opd',       interval '9 hours 24 minutes'),
      (4,  '00000000-0000-4000-8000-000000000303'::uuid, '00000000-0000-4000-8000-000000000202'::uuid, 'opd',       interval '9 hours 50 minutes'),
      (5,  '00000000-0000-4000-8000-000000000312'::uuid, '00000000-0000-4000-8000-000000000201'::uuid, 'opd',       interval '10 hours 10 minutes'),
      (6,  '00000000-0000-4000-8000-00000000030b'::uuid, '00000000-0000-4000-8000-000000000203'::uuid, 'opd',       interval '10 hours 35 minutes'),
      (7,  '00000000-0000-4000-8000-000000000309'::uuid, '00000000-0000-4000-8000-000000000202'::uuid, 'emergency', interval '11 hours 2 minutes'),
      (8,  '00000000-0000-4000-8000-000000000306'::uuid, '00000000-0000-4000-8000-000000000201'::uuid, 'opd',       interval '11 hours 25 minutes'),
      (9,  '00000000-0000-4000-8000-000000000311'::uuid, '00000000-0000-4000-8000-000000000202'::uuid, 'opd',       interval '11 hours 40 minutes'),
      (10, '00000000-0000-4000-8000-000000000308'::uuid, '00000000-0000-4000-8000-000000000203'::uuid, 'opd',       interval '12 hours 5 minutes')
    ) as t(seq, patient_id, doctor_id, visit_type, slot)
    order by seq
  loop
    -- Never book into the future: seeded before the clinic opens, everything
    -- collapses onto now() instead of pretending the morning already happened.
    v_at := least(v_day_start + r.slot, now());

    v_visit := public.create_visit(jsonb_build_object(
      'hospital_id', v_hospital,
      'patient_id',  r.patient_id,
      'doctor_id',   r.doctor_id,
      'visit_type',  r.visit_type,
      'visited_at',  v_at
    ));

    v_ids := v_ids || v_visit.id;
  end loop;

  -- A queue that is entirely "waiting" is not a queue anyone recognises. Three
  -- are done, one is with the doctor, one was cancelled at the counter, the
  -- rest are waiting. Only ever applied to the visits this block just created.
  update public.visits set status = 'completed'
   where id = any(v_ids[1:3]);
  update public.visits set status = 'in_consultation'
   where id = v_ids[4];
  update public.visits set status = 'cancelled'
   where id = v_ids[5];

  raise notice 'seed: 10 visits created for %', public.ist_date(now());
end;
$$;

-- =============================================================================
-- Today's billing -- five invoices raised through collect_payment(), so the
-- day-close screen has something in it and every path this slice added is
-- exercised at least once:
--
--   1  consultation only, paid in full, cash
--   2  consultation + an ECG added at the counter, paid by UPI with a reference
--   3  consultation + a taxable pharmacy line + a dressing at a discounted
--      rate, paid by card -- the GST-exempt-service / taxable-pharmacy mix from
--      CLAUDE.md 8, on one bill
--   4  part paid in cash, so an outstanding balance exists somewhere
--   5  paid, then VOIDED -- charges returned to the visit, payment reversed
--
-- Idempotent the same way the queue block above is: the guard is "does this
-- hospital already have invoices today", because a re-run tomorrow should
-- produce tomorrow's takings rather than nothing.
--
-- Runs as postgres, which has no JWT claim, so the hospital and the collector
-- are passed explicitly. Those two arguments exist for exactly this and are
-- refused for a signed-in caller.
-- =============================================================================
do $$
declare
  v_hospital uuid := '00000000-0000-4000-8000-000000000001';
  v_ecg      uuid := '00000000-0000-4000-8000-000000000405';
  v_para     uuid := '00000000-0000-4000-8000-00000000040b';
  v_dressing uuid := '00000000-0000-4000-8000-000000000403';
  v_user     uuid;
  v_visit    record;
  v_extras   jsonb;
  v_items    jsonb;
  v_total    numeric(12,2);
  v_paid     numeric(12,2);
  v_mode     public.payment_mode;
  v_ref      text;
  v_invoice  public.invoices;
  v_seq      int := 0;
begin
  -- Payments record who took them, and that column is not nullable
  -- (CLAUDE.md 3.2). Without a login there is nobody to record, so the demo
  -- bills are skipped rather than faked.
  select m.user_id into v_user
  from public.memberships m
  where m.hospital_id = v_hospital
    and m.role = 'super_admin'
    and m.is_active
  order by m.created_at
  limit 1;

  if v_user is null then
    raise notice 'seed: no login yet, so no demo invoices. Re-run after the auth user exists.';
    return;
  end if;

  if exists (
    select 1 from public.invoices i
    where i.hospital_id = v_hospital
      and public.ist_date(i.invoice_date) = public.ist_date(now())
  ) then
    raise notice 'seed: this hospital already has invoices today, billing left alone';
    return;
  end if;

  for v_visit in
    select v.id, v.token_no
    from public.visits v
    where v.hospital_id = v_hospital
      and public.ist_date(v.visited_at) = public.ist_date(now())
      and v.status <> 'cancelled'
      and exists (
        select 1 from public.charge_items ci
        where ci.hospital_id = v_hospital
          and ci.visit_id = v.id
          and ci.status = 'pending'
      )
    order by v.token_no
    limit 5
  loop
    v_seq := v_seq + 1;

    -- What gets added at the counter on this bill, if anything.
    v_extras := case v_seq
      when 2 then jsonb_build_array(
        jsonb_build_object('service_id', v_ecg, 'qty', 1))
      when 3 then jsonb_build_array(
        jsonb_build_object('service_id', v_para, 'qty', 2),
        -- A rate typed over the one from the charge master: the price
        -- pre-fills and stays editable.
        jsonb_build_object('service_id', v_dressing, 'qty', 1, 'unit_price', 250))
      else '[]'::jsonb
    end;

    -- The item list and the amount it comes to, from the same rows -- so the
    -- payment below is the exact total rather than a guess collect_payment
    -- would reject for being over the bill.
    select jsonb_agg(t.item), coalesce(sum(t.line_total), 0)
      into v_items, v_total
    from (
      select
        jsonb_build_object('charge_item_id', ci.id) as item,
        ci.amount + round(ci.amount * ci.tax_rate / 100, 2) as line_total
      from public.charge_items ci
      where ci.hospital_id = v_hospital
        and ci.visit_id = v_visit.id
        and ci.status = 'pending'

      union all

      select
        jsonb_build_object(
          'service_id', s.id,
          'qty', x.qty,
          'unit_price', coalesce(x.unit_price, s.price)),
        round(x.qty * coalesce(x.unit_price, s.price), 2)
          + round(round(x.qty * coalesce(x.unit_price, s.price), 2) * s.tax_rate / 100, 2)
      from jsonb_to_recordset(v_extras) as x(service_id uuid, qty numeric, unit_price numeric)
      join public.services s
        on s.id = x.service_id and s.hospital_id = v_hospital
    ) t;

    v_mode := case v_seq when 2 then 'upi' when 3 then 'card' else 'cash' end;
    v_ref  := case v_seq
      when 2 then 'UPI/402931118'
      when 3 then 'AUTH 553120'
      else null
    end;
    -- One bill is deliberately left part paid, so a balance exists on the
    -- invoice list and the day-close numbers do not all agree by accident.
    v_paid := case v_seq when 4 then round(v_total / 2, 2) else v_total end;

    v_invoice := public.collect_payment(
      p_visit_id     => v_visit.id,
      p_items        => v_items,
      p_mode         => v_mode,
      p_amount       => v_paid,
      p_reference    => v_ref,
      p_hospital_id  => v_hospital,
      p_collected_by => v_user
    );

    if v_seq = 5 then
      perform public.void_invoice(
        v_invoice.id,
        'Billed to the wrong patient at the counter',
        v_hospital
      );
      raise notice 'seed: % voided (charges returned to the visit)', v_invoice.invoice_no;
    else
      raise notice 'seed: % for token % -- % of %',
        v_invoice.invoice_no, v_visit.token_no, v_paid, v_total;
    end if;
  end loop;

  if v_seq = 0 then
    raise notice 'seed: no visits with pending charges, so no demo invoices';
  end if;
end;
$$;

-- =============================================================================
-- Consultations -- so the doctor screen opens on something written by hand
-- rather than a blank form.
--
-- Only for today's visits that are already past the waiting stage: a completed
-- visit with no note is the one state the doctor module should never produce,
-- and the visit that is in_consultation gets vitals but no notes yet, which is
-- exactly what a half-finished consultation looks like.
--
-- Idempotent on "does this visit already have a consultation", so a re-run on
-- the same day changes nothing and a re-run tomorrow writes against tomorrow's
-- queue. Written through save_consultation(), so the seed exercises the same
-- path the screen does.
-- =============================================================================
do $$
declare
  v_hospital uuid := '00000000-0000-4000-8000-000000000001';
  v_count    int  := 0;
  r          record;
  v_notes    text;
begin
  for r in
    select v.id, v.status, row_number() over (order by v.token_no) as seq
    from public.visits v
    where v.hospital_id = v_hospital
      and public.ist_date(v.visited_at) = public.ist_date(now())
      and v.status in ('completed', 'in_consultation')
      and not exists (
        select 1 from public.consultations c
        where c.hospital_id = v.hospital_id and c.visit_id = v.id
      )
    order by v.token_no
  loop
    -- The notes are deliberately the way a busy OPD doctor actually types:
    -- short, abbreviated, and not a paragraph.
    v_notes := case r.seq % 3
      when 1 then 'Fever x 3 days, dry cough. No breathlessness. Chest clear, throat mildly congested.' || chr(10) ||
                  'Likely viral URI. Advised fluids, rest. Review in 3 days if fever persists.'
      when 2 then 'Follow-up for BP. Compliant with medication, no giddiness or headache.' || chr(10) ||
                  'Continue same dose. Repeat BP in 2 weeks at the desk.'
      else        'C/o low back pain since 1 week, no radiation, no numbness. SLR negative.' || chr(10) ||
                  'Mechanical low back pain. Advised local heat and posture correction.'
    end;

    perform public.save_consultation(jsonb_build_object(
      'hospital_id',   v_hospital,
      'visit_id',      r.id,
      'bp_systolic',   118 + (r.seq * 7) % 26,
      'bp_diastolic',   72 + (r.seq * 3) % 12,
      'pulse',          68 + (r.seq * 5) % 22,
      'temperature_f', round((97.6 + ((r.seq * 4) % 25) / 10.0)::numeric, 1),
      'weight_kg',     round((54 + (r.seq * 9) % 31)::numeric, 2),
      'spo2',           96 + (r.seq % 4),
      -- A consultation still in progress has the vitals and not yet the note.
      'notes',         case when r.status = 'completed' then v_notes else null end
    ));

    v_count := v_count + 1;
  end loop;

  raise notice 'seed: % consultation(s) written for %', v_count, public.ist_date(now());
end;
$$;

-- =============================================================================
-- Exercising the tenant lifecycle (20260825140000)
--
-- Nothing below runs. Suspending the demo hospital as part of the seed would
-- leave the demo unusable, so these are the statements to paste when you want
-- to see the block, and the one that undoes it.
--
--   -- suspend: the app redirects to /suspended and quotes this reason.
--   update public.hospitals
--      set status = 'suspended',
--          suspension_reason = 'Subscription payment overdue since 1 August.'
--    where id = '00000000-0000-4000-8000-000000000001';
--
--   -- expire a trial instead: same block, different screen, different fix.
--   update public.hospitals
--      set plan = 'trial', trial_ends_at = now() - interval '1 day'
--    where id = '00000000-0000-4000-8000-000000000001';
--
--   -- the trial banner rather than the block: put the end date a few days out.
--   update public.hospitals
--      set plan = 'trial', trial_ends_at = now() + interval '3 days'
--    where id = '00000000-0000-4000-8000-000000000001';
--
--   -- back to normal (also what a re-run of this seed does).
--   update public.hospitals
--      set plan = 'standard', status = 'active'
--    where id = '00000000-0000-4000-8000-000000000001';
--
-- suspended_at is never set by hand in any of these: hospitals_stamp_suspension
-- stamps it on the way in, and clears it along with the reason when the
-- hospital goes active again.
-- =============================================================================

-- =============================================================================
-- The one-transaction register desk -- block 4.
--
-- Three registrations through register_patient_visit(), so the demo data
-- covers what the new screen actually produces rather than only what the older
-- create_visit path did:
--
--   * a cash registration, paid in full at the desk
--   * a DEFERRED one, which leaves the invoice owing and writes the reason to
--     visit_payment_deferrals -- this is what puts a PAYMENT DUE badge on the
--     queue and on the visit header
--   * a TRANSFER, so /front-desk/queue has a row whose token was reissued and
--     visit_transfers has something in it
--
-- Guarded on "has this hospital already registered somebody this way today",
-- for the same reason the queue block above is: the screens show TODAY, so a
-- re-run tomorrow has to produce today's rows.
--
-- p_hospital_id and p_actor_id are the two arguments that exist only for
-- callers with no JWT. A signed-in clerk supplies neither -- the tenant comes
-- from the token and the collector from auth.uid() (CLAUDE.md 3.1, 3.2).
-- =============================================================================
do $$
declare
  v_hospital uuid := '00000000-0000-4000-8000-000000000001';
  v_actor    uuid;
  v_doctor_a uuid := '00000000-0000-4000-8000-000000000201';
  v_doctor_b uuid := '00000000-0000-4000-8000-000000000202';
  v_result   jsonb;
begin
  if exists (
    select 1 from public.visit_payment_deferrals d
    join public.visits v on v.hospital_id = d.hospital_id and v.id = d.visit_id
    where d.hospital_id = v_hospital
      and public.ist_date(v.visited_at) = public.ist_date(now())
  ) then
    raise notice 'seed: today already has a deferred registration, desk demo left alone';
    return;
  end if;

  -- Whoever created the demo hospital. payments.collected_by is NOT NULL, so
  -- without a login there is nobody to attribute a collection to and this
  -- block has nothing useful to seed.
  select m.user_id into v_actor
  from public.memberships m
  where m.hospital_id = v_hospital and m.is_active
  order by m.created_at
  limit 1;

  if v_actor is null then
    raise notice 'seed: no membership on the demo hospital, desk demo skipped';
    return;
  end if;

  -- 1. Paid at the desk, the ordinary case.
  v_result := public.register_patient_visit(
    p_hospital_id  => v_hospital,
    p_patient      => jsonb_build_object(
                        'full_name', 'Meenakshi Sundaram',
                        'dob',       '1979-07-14',
                        'gender',    'female',
                        'phone',     '+91 98861 20034',
                        'address',   '22 Bazaar Street, Jayanagar, Bengaluru 560011'
                      ),
    p_doctor_id    => v_doctor_a,
    p_payment_mode => 'upi',
    p_actor_id     => v_actor
  );
  raise notice 'seed: registered % on token %',
    v_result ->> 'mrn', v_result ->> 'token_no';

  -- 2. Seen before paying. Rare, visible, auditable -- never a silent skip.
  --    A family sharing one mobile is deliberate here too: this is the same
  --    phone as the registration above, and nothing blocks it (defect 4).
  v_result := public.register_patient_visit(
    p_hospital_id  => v_hospital,
    p_patient      => jsonb_build_object(
                        'full_name', 'Arjun Sundaram',
                        'dob',       '2016-03-02',
                        'gender',    'male',
                        'phone',     '+91 98861 20034',
                        'address',   '22 Bazaar Street, Jayanagar, Bengaluru 560011'
                      ),
    p_doctor_id    => v_doctor_a,
    p_deferred     => true,
    p_defer_reason => 'Mother is paying for both; will settle at the counter together',
    p_actor_id     => v_actor
  );
  raise notice 'seed: deferred registration on token %', v_result ->> 'token_no';

  -- 3. Registered to the wrong doctor and moved. The old token is retired,
  --    not reused, and the reason is on the record.
  v_result := public.register_patient_visit(
    p_hospital_id  => v_hospital,
    p_patient      => jsonb_build_object(
                        'full_name', 'Ganesh Pai',
                        'dob',       '1965-11-30',
                        'gender',    'male',
                        'phone',     '+91 99017 45521'
                      ),
    p_doctor_id    => v_doctor_a,
    p_payment_mode => 'cash',
    p_actor_id     => v_actor
  );

  v_result := public.transfer_visit(
    p_visit_id    => (v_result ->> 'visit_id')::uuid,
    p_doctor_id   => v_doctor_b,
    p_reason      => 'Chest pain, moved to the physician on duty',
    p_hospital_id => v_hospital
  );
  raise notice 'seed: transferred to % on token %',
    v_result ->> 'doctor_name', v_result ->> 'token_no';
end;
$$;

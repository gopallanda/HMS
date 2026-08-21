-- =============================================================================
-- seed.sql -- demo data. Run with `npm run db:seed` (hosted project, no Docker).
--
-- Creates: one hospital, three departments, five staff across five roles, and
-- a super_admin login that can sign in immediately.
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
-- Runs as the postgres role: RLS does not apply, and the audit rows it writes
-- carry actor_id null.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The hospital
-- -----------------------------------------------------------------------------
insert into public.hospitals (id, name, address, phone, gstin, settings)
values (
  '00000000-0000-4000-8000-000000000001',
  'Sunrise Multispeciality Hospital',
  '14 MG Road, Indiranagar, Bengaluru 560038',
  '+91 80 4123 5566',
  '29ABCDE1234F1Z5',
  jsonb_build_object('receipt_default', 'thermal_80mm')
)
on conflict (id) do nothing;

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
-- Staff. Five people, five roles.
--
-- user_id stays null here: a staff record exists before a login does
-- (CLAUDE.md 4). The block at the bottom attaches the one login this seed
-- creates.
--
-- Only the doctors carry a consultation fee. Three different fees, because
-- Phase 1 seeds the consultation charge_item from this column and a flat rate
-- would hide a bug there.
-- -----------------------------------------------------------------------------
insert into public.staff
  (id, hospital_id, full_name, role, department_id, phone, reg_no, consultation_fee) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'Dr. Anjali Rao',    'doctor',     '00000000-0000-4000-8000-000000000101', '+91 98450 11223', 'KMC/2011/45231', 500.00),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', 'Dr. Vikram Shetty', 'doctor',     '00000000-0000-4000-8000-000000000102', '+91 98450 11224', 'KMC/2008/33110', 700.00),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', 'Dr. Meera Nair',    'doctor',     '00000000-0000-4000-8000-000000000103', '+91 98450 11225', 'KMC/2015/61802', 450.00),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', 'Lakshmi Prasad',    'front_desk', null,                                   '+91 98450 11226', null,             0),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', 'Ramesh Kumar',      'cashier',    null,                                   '+91 98450 11227', null,             0)
on conflict (id) do nothing;

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
insert into public.services (id, hospital_id, name, category, price, tax_rate, created_at) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'Consultation - OPD',          'consultation',  500.00,  0.00, now() - interval '60 minutes'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', 'Consultation - Follow up',    'consultation',  200.00,  0.00, now() - interval '59 minutes'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', 'Dressing',                    'procedure',     300.00,  0.00, now() - interval '58 minutes'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', 'Nebulisation',                'procedure',     250.00,  0.00, now() - interval '57 minutes'),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', 'ECG',                         'procedure',     400.00,  0.00, now() - interval '56 minutes'),
  ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000001', 'Complete Blood Count',        'lab',           350.00,  0.00, now() - interval '55 minutes'),
  ('00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000001', 'Blood Sugar - Fasting',       'lab',           120.00,  0.00, now() - interval '54 minutes'),
  ('00000000-0000-4000-8000-000000000408', '00000000-0000-4000-8000-000000000001', 'Urine Routine',               'lab',           200.00,  0.00, now() - interval '53 minutes'),
  ('00000000-0000-4000-8000-000000000409', '00000000-0000-4000-8000-000000000001', 'General Ward - per day',      'bed',          1500.00,  0.00, now() - interval '52 minutes'),
  ('00000000-0000-4000-8000-00000000040a', '00000000-0000-4000-8000-000000000001', 'Semi-private Room - per day', 'bed',          3000.00,  0.00, now() - interval '51 minutes'),
  ('00000000-0000-4000-8000-00000000040b', '00000000-0000-4000-8000-000000000001', 'Paracetamol 650mg - strip',   'pharmacy',       30.00, 12.00, now() - interval '50 minutes'),
  ('00000000-0000-4000-8000-00000000040c', '00000000-0000-4000-8000-000000000001', 'Ambulance - local',           'other',         800.00,  0.00, now() - interval '49 minutes')
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

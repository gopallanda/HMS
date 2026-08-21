-- =============================================================================
-- 20260818120100_patient_visit_rpcs.sql
-- register_patient, create_visit and the search the front desk types into.
--
-- CLAUDE.md 4 specifies register_patient and create_visit. Both are
-- SECURITY DEFINER, because patients and charge_items have no insert policy at
-- all -- these functions are the only way a row gets in, which is the point
-- (CLAUDE.md 3.2).
--
-- SECURITY DEFINER means RLS does not protect these bodies, so each one starts
-- by resolving the tenant from the JWT and checking the caller's role itself.
--
-- Error codes raised here, for the app to map (lib/supabase/errors.ts):
--   42501  cross-tenant access, or a role that may not do this
--   90001  register_patient: the phone already belongs to a patient, and
--          force_create was not set. Not really an error: families share one
--          mobile. The desk is asked, then decides.
-- Everything else is a plain raise: the message is written to be readable by
-- the person at the desk, and describeDatabaseError passes it through.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which hospital is this call for?
--
-- A signed-in caller: their JWT claim, always. A payload asking for a
-- different hospital is refused rather than ignored, so a tampered request
-- fails loudly instead of quietly writing somewhere unexpected.
--
-- No claim means the service role, a migration or seed.sql -- trusted by
-- definition, and required to say which hospital it means.
-- -----------------------------------------------------------------------------
create or replace function public.rpc_hospital_id(p_requested uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claim uuid := public.app_hospital_id();
begin
  if v_claim is null then
    -- A signed-in user with no hospital claim is not a trusted caller, it is a
    -- user with no membership (or a project with the access token hook still
    -- switched off). Without this line the payload could name any hospital it
    -- liked and be believed.
    if auth.uid() is not null then
      raise exception 'This account has no active hospital membership.'
        using errcode = '42501';
    end if;

    if p_requested is null then
      raise exception 'hospital_id is required when there is no session'
        using errcode = '42501';
    end if;
    return p_requested;
  end if;

  if p_requested is not null and p_requested <> v_claim then
    raise exception 'cross-tenant access denied'
      using errcode = '42501';
  end if;

  return v_claim;
end;
$$;

comment on function public.rpc_hospital_id(uuid) is
  'Tenant for an RPC call: the JWT claim for a signed-in caller, the explicit argument for the service role. Never both.';

-- -----------------------------------------------------------------------------
-- May the caller work the front desk?
--
-- Null role means no session: service role, seed, migration. Fine-grained
-- permissions live in server code and RPCs rather than in policies
-- (CLAUDE.md 5), and this is the RPC half of that.
-- -----------------------------------------------------------------------------
create or replace function public.assert_front_desk()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role public.app_role := public.app_role();
begin
  if v_role is null then
    return;
  end if;

  if not public.has_role('super_admin', 'admin', 'front_desk') then
    raise exception 'Only the front desk can register patients and start visits.'
      using errcode = '42501';
  end if;
end;
$$;

-- =============================================================================
-- search_patients -- the search-first register screen (CLAUDE.md 3.3).
--
-- SECURITY INVOKER (the default) on purpose: this is a read, so RLS is exactly
-- the right guard and the policy does the tenant filtering.
--
-- Three matches, each backed by its own trigram index:
--   * phone, compared on digits only, so '+91 98450 11223' answers to
--     '9845011223' and to '11223'
--   * name, as a substring, because staff type the surname
--   * MRN, as a substring, because staff type the tail off the card
--
-- Below 3 characters it returns nothing: a shorter pattern holds no whole
-- trigram, so it could not use an index and would scan the table on every
-- keystroke.
-- =============================================================================
create or replace function public.search_patients(
  p_query text,
  p_limit int default 10
)
returns table (
  id             uuid,
  mrn            text,
  full_name      text,
  dob            date,
  gender         public.gender,
  phone          text,
  address        text,
  last_visit_at  timestamptz,
  visit_count    bigint
)
language plpgsql
stable
set search_path = ''
as $$
-- The RETURNS TABLE columns are also plpgsql variables, and a bare `id` in the
-- query below would resolve to the variable rather than the column. Every
-- reference here is qualified anyway; this makes the rule explicit instead of
-- leaving it to a future edit to get right.
#variable_conflict use_column
declare
  v_text   text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
  v_limit  int  := least(greatest(coalesce(p_limit, 10), 1), 25);
  v_like   text;
begin
  -- Below three characters the pattern holds no whole trigram, so no index can
  -- serve it. Returning nothing beats scanning the table on every keystroke.
  if length(v_text) < 3 then
    return;
  end if;

  v_like := '%' || v_text || '%';

  return query
  select
    p.id,
    p.mrn,
    p.full_name,
    p.dob,
    p.gender,
    p.phone,
    p.address,
    v.last_visit_at,
    coalesce(v.visit_count, 0)
  from public.patients p
  left join lateral (
    select max(vi.visited_at) as last_visit_at, count(*) as visit_count
    from public.visits vi
    where vi.hospital_id = p.hospital_id
      and vi.patient_id = p.id
  ) v on true
  where p.deleted_at is null
    and (
      p.full_name ilike v_like
      or p.mrn ilike v_like
      or (
        length(v_digits) >= 3
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            like '%' || v_digits || '%'
      )
    )
  -- Most recently seen first: the person at the counter today is usually the
  -- person who was here last month, not the one from four years ago.
  order by v.last_visit_at desc nulls last, p.full_name
  limit v_limit;
end;
$$;

comment on function public.search_patients(text, int) is
  'Front-desk patient search by phone digits, name or MRN. Read-only, RLS applies. Returns nothing for queries shorter than 3 characters.';

revoke execute on function public.search_patients(text, int) from public, anon;
grant execute on function public.search_patients(text, int) to authenticated;

-- =============================================================================
-- register_patient(payload) -> patient
--
-- CLAUDE.md 4: allocates the MRN via next_number, and fails loudly on a
-- duplicate phone unless force_create is true.
--
-- payload keys:
--   id                 uuid, optional -- client-generated (CLAUDE.md 7). Sent
--                      again after a dropped connection, it returns the row
--                      that was already written instead of a second patient.
--   hospital_id        uuid, required only for service-role callers
--   full_name          text, required
--   dob                date, required -- age is computed, never stored
--   gender             male | female | other
--   phone, address     text, optional
--   force_create       boolean, default false
-- =============================================================================
create or replace function public.register_patient(payload jsonb)
returns public.patients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_id          uuid;
  v_full_name   text;
  v_dob         date;
  v_gender      public.gender;
  v_phone       text;
  v_address     text;
  v_digits      text;
  v_force       boolean;
  v_mrn         text;
  v_existing    public.patients;
  v_matches     text;
  v_count       int;
begin
  v_hospital_id := public.rpc_hospital_id(nullif(payload ->> 'hospital_id', '')::uuid);
  perform public.assert_front_desk();

  v_id        := nullif(payload ->> 'id', '')::uuid;
  v_full_name := btrim(coalesce(payload ->> 'full_name', ''));
  v_phone     := nullif(btrim(coalesce(payload ->> 'phone', '')), '');
  v_address   := nullif(btrim(coalesce(payload ->> 'address', '')), '');
  v_force     := coalesce((payload ->> 'force_create')::boolean, false);

  -- ---------------------------------------------------------------------------
  -- Idempotency first: same id, same row. This runs before validation so a
  -- retry cannot fail on a rule that has since changed.
  -- ---------------------------------------------------------------------------
  if v_id is not null then
    select p.* into v_existing
    from public.patients p
    where p.id = v_id and p.hospital_id = v_hospital_id;

    if found then
      return v_existing;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Validation. The same rules live in lib/schemas/patient.ts so the desk sees
  -- them before the round trip; they are repeated here because an RPC is
  -- reachable without the form.
  -- ---------------------------------------------------------------------------
  if length(v_full_name) < 2 then
    raise exception 'A patient name is required.';
  end if;

  begin
    v_dob := (payload ->> 'dob')::date;
  exception when others then
    raise exception 'Date of birth must be a real date, as YYYY-MM-DD.';
  end;

  if v_dob is null then
    raise exception 'Date of birth is required. Enter an age if the patient does not know it.';
  end if;
  if v_dob > public.ist_date(now()) then
    raise exception 'Date of birth cannot be in the future.';
  end if;
  if v_dob < public.ist_date(now()) - interval '130 years' then
    raise exception 'Date of birth is too far in the past.';
  end if;

  begin
    v_gender := (payload ->> 'gender')::public.gender;
  exception when others then
    raise exception 'Gender must be male, female or other.';
  end;

  if v_gender is null then
    raise exception 'Gender is required.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Duplicate phone.
  --
  -- Compared on digits, so a number stored as '+91 98450 11223' is recognised
  -- when it is typed as '9845011223'. This is a question, not a verdict: an
  -- Indian family routinely shares one mobile, so force_create exists and the
  -- desk answers it. What is NOT allowed is registering the same person twice
  -- by accident, which is what an unasked question produces.
  -- ---------------------------------------------------------------------------
  v_digits := regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');

  if not v_force and length(v_digits) >= 6 then
    select count(*), string_agg(p.mrn || ' ' || p.full_name, ', ' order by p.created_at)
      into v_count, v_matches
    from public.patients p
    where p.hospital_id = v_hospital_id
      and p.deleted_at is null
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_digits;

    if v_count > 0 then
      raise exception
        'That phone number already belongs to % patient(s) here.', v_count
        using errcode = '90001',
              detail  = v_matches,
              hint    = 'Open the existing record, or confirm to register a separate patient on the same number.';
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- MRN, then the row. next_number holds its lock until this transaction ends,
  -- so a failure below returns the number instead of burning it.
  -- ---------------------------------------------------------------------------
  v_mrn := public.next_number(v_hospital_id, 'mrn');

  insert into public.patients (
    id, hospital_id, mrn, full_name, dob, gender, phone, address, created_by
  )
  values (
    coalesce(v_id, gen_random_uuid()),
    v_hospital_id,
    v_mrn,
    v_full_name,
    v_dob,
    v_gender,
    v_phone,
    v_address,
    auth.uid()
  )
  returning * into v_existing;

  return v_existing;
end;
$$;

comment on function public.register_patient(jsonb) is
  'Creates a patient with an MRN from next_number. Idempotent on a client-supplied id. Raises 90001 on a duplicate phone unless force_create is true.';

revoke execute on function public.register_patient(jsonb) from public, anon;
grant execute on function public.register_patient(jsonb) to authenticated;

-- =============================================================================
-- create_visit(payload) -> visit
--
-- CLAUDE.md 4: allocates visit_no and a queue token, and optionally seeds a
-- consultation charge_item from the doctor's fee.
--
-- payload keys:
--   id                       uuid, optional -- client-generated, idempotent
--   hospital_id              uuid, required only for service-role callers
--   patient_id               uuid, required
--   doctor_id                uuid, optional (an emergency arrives before a
--                            doctor is assigned)
--   department_id            uuid, optional -- defaults to the doctor's
--   visit_type               opd | ipd | emergency, default opd
--   visited_at               timestamptz, honoured only for service-role
--                            callers (seed data). A signed-in desk always
--                            gets now(): back-dating a visit moves money into
--                            a day that has already been closed.
--   seed_consultation        boolean, default true
--   consultation_service_id  uuid, optional -- overrides the default
--                            consultation service on the charge line
-- =============================================================================
create or replace function public.create_visit(payload jsonb)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id   uuid;
  v_id            uuid;
  v_patient_id    uuid;
  v_doctor_id     uuid;
  v_department_id uuid;
  v_visit_type    public.visit_type;
  v_visited_at    timestamptz;
  v_day           date;
  v_visit_no      text;
  v_token         int;
  v_visit         public.visits;
  v_patient       public.patients;
  v_doctor        public.staff;
  v_seed          boolean;
  v_service       public.services;
  v_service_id    uuid;
  v_fee           numeric(12,2);
begin
  v_hospital_id := public.rpc_hospital_id(nullif(payload ->> 'hospital_id', '')::uuid);
  perform public.assert_front_desk();

  v_id            := nullif(payload ->> 'id', '')::uuid;
  v_patient_id    := nullif(payload ->> 'patient_id', '')::uuid;
  v_doctor_id     := nullif(payload ->> 'doctor_id', '')::uuid;
  v_department_id := nullif(payload ->> 'department_id', '')::uuid;
  v_seed          := coalesce((payload ->> 'seed_consultation')::boolean, true);
  v_service_id    := nullif(payload ->> 'consultation_service_id', '')::uuid;

  -- Idempotency: a resubmitted form returns the visit it already created,
  -- rather than a second token for the same patient.
  if v_id is not null then
    select v.* into v_visit
    from public.visits v
    where v.id = v_id and v.hospital_id = v_hospital_id;

    if found then
      return v_visit;
    end if;
  end if;

  begin
    v_visit_type := coalesce((payload ->> 'visit_type')::public.visit_type, 'opd');
  exception when others then
    raise exception 'Visit type must be opd, ipd or emergency.';
  end;

  -- Back-dating is a service-role privilege (seed data, migrations). A desk
  -- session always books into the current day.
  if public.app_hospital_id() is null then
    v_visited_at := coalesce((payload ->> 'visited_at')::timestamptz, now());
  else
    v_visited_at := now();
  end if;

  -- ---------------------------------------------------------------------------
  -- The patient must exist, be ours, and not be soft-deleted. The composite
  -- foreign key already guarantees the tenant; this is here to produce a
  -- sentence instead of a constraint name.
  -- ---------------------------------------------------------------------------
  if v_patient_id is null then
    raise exception 'A visit needs a patient. Search for one first.';
  end if;

  select p.* into v_patient
  from public.patients p
  where p.id = v_patient_id and p.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That patient record no longer exists.';
  end if;
  if v_patient.deleted_at is not null then
    raise exception 'That patient record has been removed.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The doctor, when there is one. Must be an active doctor of this hospital:
  -- a visit sent to a deactivated doctor never appears in anyone's queue.
  -- ---------------------------------------------------------------------------
  if v_doctor_id is not null then
    select s.* into v_doctor
    from public.staff s
    where s.id = v_doctor_id and s.hospital_id = v_hospital_id;

    if not found then
      raise exception 'That doctor is not on the staff list.';
    end if;
    if v_doctor.role <> 'doctor' then
      raise exception '% is not a doctor.', v_doctor.full_name;
    end if;
    if not v_doctor.is_active then
      raise exception '% is no longer active.', v_doctor.full_name;
    end if;

    -- The department follows the doctor unless the desk chose one.
    v_department_id := coalesce(v_department_id, v_doctor.department_id);
  end if;

  -- ---------------------------------------------------------------------------
  -- visit_no from number_series (per hospital, per financial year), and the
  -- queue token, which is per DAY and therefore not from number_series at all.
  --
  -- The advisory lock is held to the end of this transaction and serialises
  -- token allocation for this hospital and day only -- two hospitals, or the
  -- same hospital tomorrow, never wait on each other. max()+1 under that lock
  -- is exact, and a rolled-back visit gives its token back, which is what the
  -- queue on the wall expects. visits_hospital_id_day_token_key enforces it.
  -- ---------------------------------------------------------------------------
  v_visit_no := public.next_number(v_hospital_id, 'visit');
  v_day      := public.ist_date(v_visited_at);

  perform pg_advisory_xact_lock(hashtext(v_hospital_id::text || ':' || v_day::text)::bigint);

  select coalesce(max(v.token_no), 0) + 1
    into v_token
  from public.visits v
  where v.hospital_id = v_hospital_id
    and public.ist_date(v.visited_at) = v_day;

  insert into public.visits (
    id, hospital_id, patient_id, visit_no, token_no, visit_type,
    doctor_id, department_id, status, visited_at, created_by
  )
  values (
    coalesce(v_id, gen_random_uuid()),
    v_hospital_id,
    v_patient_id,
    v_visit_no,
    v_token,
    v_visit_type,
    v_doctor_id,
    v_department_id,
    'waiting',
    v_visited_at,
    auth.uid()
  )
  returning * into v_visit;

  -- ---------------------------------------------------------------------------
  -- The consultation charge.
  --
  -- The amount comes from the doctor's own fee (CLAUDE.md 4), not from the
  -- charge master: two doctors in one department charge different amounts, and
  -- the fee on the staff row is the one the hospital actually collects. The
  -- service is attached for reporting, and carries the tax rate -- consultation
  -- is GST-exempt, so that is normally 0 and is never assumed (CLAUDE.md 8).
  --
  -- Written here, inside the same transaction as the visit, because charge_items
  -- has no insert policy: RPCs are the only writer (CLAUDE.md 3.2).
  -- ---------------------------------------------------------------------------
  if v_seed and v_doctor_id is not null then
    v_fee := coalesce(v_doctor.consultation_fee, 0);

    if v_fee > 0 then
      if v_service_id is not null then
        select s.* into v_service
        from public.services s
        where s.id = v_service_id
          and s.hospital_id = v_hospital_id
          and s.is_active;

        if not found then
          raise exception 'That consultation service is not available.';
        end if;
      else
        -- The hospital's default consultation service: the first one it
        -- created. Deterministic, and overridable per call.
        select s.* into v_service
        from public.services s
        where s.hospital_id = v_hospital_id
          and s.category = 'consultation'
          and s.is_active
        order by s.created_at, s.name
        limit 1;
      end if;

      insert into public.charge_items (
        hospital_id, visit_id, service_id, description,
        qty, unit_price, amount, tax_rate,
        source_module, status, created_by
      )
      values (
        v_hospital_id,
        v_visit.id,
        v_service.id,
        'Consultation - ' || v_doctor.full_name,
        1,
        v_fee,
        v_fee,
        coalesce(v_service.tax_rate, 0),
        'front_desk',
        'pending',
        auth.uid()
      );
    end if;
  end if;

  return v_visit;
end;
$$;

comment on function public.create_visit(jsonb) is
  'Creates a visit with a visit_no from next_number and a per-day queue token, and seeds the consultation charge from the doctor fee. Idempotent on a client-supplied id.';

revoke execute on function public.create_visit(jsonb) from public, anon;
grant execute on function public.create_visit(jsonb) to authenticated;

grant execute on function public.rpc_hospital_id(uuid)  to authenticated;
grant execute on function public.assert_front_desk()    to authenticated;

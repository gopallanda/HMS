-- =============================================================================
-- 20260820120000_consultations.sql
-- The doctor module, Phase 1 (minimal): one clinical record per visit.
--
-- Scope, deliberately: vitals and free-text notes. Prescriptions, diagnoses
-- and structured history are a later phase (CLAUDE.md 1) and are NOT modelled
-- here -- a `notes` column that later grows siblings is a smaller migration
-- than a half-built prescription table nobody used.
--
-- Nothing in patients, visits, invoices, payments or charge_items changes
-- (CLAUDE.md 10). The doctor screen writes one new table and moves
-- visits.status, which that column already supports.
--
-- Rules honoured (CLAUDE.md 3.1):
--   * hospital_id not null references hospitals(id)
--   * every unique constraint scoped to hospital_id
--   * every composite index leads with hospital_id
--   * composite FKs pin the tenant, so a consultation cannot point at another
--     hospital's visit even if the app asks it to
--
-- Error codes raised here, for lib/supabase/errors.ts to map:
--   42501  wrong hospital, a role that may not record a consultation, or a
--          doctor writing on another doctor's patient
-- =============================================================================

-- -----------------------------------------------------------------------------
-- current_staff_id -- the staff row behind the login, in the active hospital.
--
-- The queue is "visits assigned to ME", and `me` is a staff id, not a user id:
-- visits.doctor_id references staff, because a staff record exists before a
-- login does (CLAUDE.md 4). Null is a normal answer -- an administrator with
-- no staff record still signs in, they just have no queue of their own.
--
-- SECURITY INVOKER: staff_select_tenant already scopes reads to the caller's
-- hospital, so RLS is the right guard and this cannot reach another tenant.
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id
  from public.staff s
  where s.hospital_id = public.app_hospital_id()
    and s.user_id = (select auth.uid())
  limit 1;
$$;

comment on function public.current_staff_id() is
  'staff.id for the signed-in user in the active hospital, or null when the login has no staff record.';

revoke execute on function public.current_staff_id() from public, anon;
grant execute on function public.current_staff_id() to authenticated;

-- -----------------------------------------------------------------------------
-- May the caller touch a clinical record?
--
-- Same shape as assert_front_desk() and assert_billing(): a null role means no
-- session at all -- service role, seed, migration -- which is trusted by
-- definition. Nurses are on the list because vitals are taken before the
-- doctor sees the patient, which is the whole reason the vitals live on the
-- consultation rather than inside the notes.
-- -----------------------------------------------------------------------------
create or replace function public.assert_clinical()
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

  if not public.has_role('super_admin', 'admin', 'doctor', 'nurse') then
    raise exception 'Only clinical staff can record a consultation.'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.assert_clinical() from public, anon;
grant execute on function public.assert_clinical() to authenticated;

-- =============================================================================
-- consultations -- one row per visit.
--
-- unique (hospital_id, visit_id) is the point of the table: a visit is one
-- encounter, so opening the same patient twice edits one record instead of
-- growing a pile of near-identical notes. save_consultation upserts on it.
--
-- Every vital is nullable, and independently so. A patient comes in for a
-- dressing change, gets a pulse taken and nothing else; a form that demanded
-- all six would be filled with invented numbers inside a week.
--
-- The ranges below are not clinical opinions, they are typo guards: they
-- reject 1200 for a pulse and accept everything a real patient can present
-- with, including the alarming end of it.
-- =============================================================================
create table public.consultations (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals(id),
  visit_id       uuid not null,
  patient_id     uuid not null,
  -- Who the visit was booked to, copied at write time. Null only when the
  -- visit itself has no doctor yet (an emergency registered before triage).
  doctor_id      uuid,

  -- vitals -------------------------------------------------------------------
  bp_systolic    smallint     check (bp_systolic  between 50 and 300),
  bp_diastolic   smallint     check (bp_diastolic between 20 and 200),
  pulse          smallint     check (pulse        between 20 and 250),
  -- Fahrenheit: an Indian OPD chart reads 98.6, not 37. One unit, stored, and
  -- no per-row unit column to get wrong.
  temperature_f  numeric(4,1) check (temperature_f between 90.0 and 110.0),
  weight_kg      numeric(5,2) check (weight_kg > 0 and weight_kg <= 400),
  spo2           smallint     check (spo2 between 50 and 100),

  notes          text,

  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),

  constraint consultations_hospital_id_visit_id_key unique (hospital_id, visit_id),
  constraint consultations_hospital_id_id_key       unique (hospital_id, id),

  constraint consultations_visit_same_hospital_fkey
    foreign key (hospital_id, visit_id)
    references public.visits (hospital_id, id),
  constraint consultations_patient_same_hospital_fkey
    foreign key (hospital_id, patient_id)
    references public.patients (hospital_id, id),
  constraint consultations_doctor_same_hospital_fkey
    foreign key (hospital_id, doctor_id)
    references public.staff (hospital_id, id),

  -- A blood pressure is a pair. Half of one is a transcription error, not a
  -- reading, and it prints on the chart as "120/".
  constraint consultations_bp_is_a_pair
    check (num_nulls(bp_systolic, bp_diastolic) <> 1),
  constraint consultations_bp_systolic_above_diastolic
    check (
      bp_systolic is null
      or bp_diastolic is null
      or bp_systolic > bp_diastolic
    )
);

-- This patient's earlier consultations -- the history panel, and what the
-- later phases will page through.
create index consultations_hospital_id_patient_id_created_at_idx
  on public.consultations (hospital_id, patient_id, created_at desc);

-- "What did I see today", and the doctor's own record over time.
create index consultations_hospital_id_doctor_id_created_at_idx
  on public.consultations (hospital_id, doctor_id, created_at desc);

comment on table public.consultations is
  'One clinical record per visit: vitals plus free-text notes. Written only by save_consultation. Prescriptions and structured history are a later phase.';
comment on column public.consultations.temperature_f is
  'Degrees Fahrenheit. Indian charts are written in F; the column carries one unit so nothing downstream has to guess.';
comment on column public.consultations.doctor_id is
  'The visit doctor at the time of writing. Kept here so the record survives a later correction to visits.doctor_id.';

-- A clinical record is exactly the kind of row somebody asks about a year
-- later (CLAUDE.md 3.5). Nothing hard-deletes one; a correction is an update,
-- and the trigger keeps what the note said before.
create trigger consultations_audit
  after insert or update or delete on public.consultations
  for each row execute function public.fn_audit();

-- =============================================================================
-- RLS
--
-- Narrower than the other Phase 1 tables, on purpose. patients and visits are
-- readable by the whole hospital -- the cashier needs a name for a bill. A
-- consultation note is not that: the counter has no reason to read what the
-- doctor wrote, so the select policy names the clinical roles.
--
-- No insert or update policy at all: save_consultation is the only writer. No
-- delete policy, as everywhere else in this schema.
-- =============================================================================
alter table public.consultations enable row level security;

create policy consultations_select_clinical on public.consultations
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'doctor', 'nurse')
  );

-- =============================================================================
-- save_consultation(payload) -> consultation
--
-- One call: write the vitals and the notes, and move the visit's status. Both
-- in one transaction, because "saved the notes but the patient is still shown
-- as waiting" is the failure a doctor would never think to check for.
--
-- payload keys:
--   id             uuid, optional -- client-generated (CLAUDE.md 7). Used only
--                  on the first write for a visit; after that the row is found
--                  by visit_id and this is ignored.
--   hospital_id    uuid, required only for service-role callers
--   visit_id       uuid, required
--   bp_systolic    int    | null
--   bp_diastolic   int    | null
--   pulse          int    | null
--   temperature_f  number | null
--   weight_kg      number | null
--   spo2           int    | null
--   notes          text   | null
--   visit_status   'in_consultation' | 'completed' | null (leave as it is)
--
-- The vitals are REPLACED, not merged: the form always posts all six, so a
-- field the doctor cleared has to be able to become null again. A caller that
-- sends a partial payload will blank whatever it omitted -- which is why there
-- is one form and one RPC rather than a general-purpose patch.
-- =============================================================================
create or replace function public.save_consultation(payload jsonb)
returns public.consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_id          uuid;
  v_visit_id    uuid;
  v_visit       public.visits;
  v_status      public.visit_status;
  v_staff_id    uuid := public.current_staff_id();
  v_notes       text;
  v_row         public.consultations;
begin
  v_hospital_id := public.rpc_hospital_id(nullif(payload ->> 'hospital_id', '')::uuid);
  perform public.assert_clinical();

  v_id       := nullif(payload ->> 'id', '')::uuid;
  v_visit_id := nullif(payload ->> 'visit_id', '')::uuid;
  v_notes    := nullif(btrim(coalesce(payload ->> 'notes', '')), '');

  if v_visit_id is null then
    raise exception 'A consultation needs a visit. Open one from your queue.';
  end if;

  select v.* into v_visit
  from public.visits v
  where v.id = v_visit_id and v.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That visit no longer exists.';
  end if;

  if v_visit.status = 'cancelled' then
    raise exception 'That visit was cancelled at the front desk. Nothing was saved.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Whose patient is this?
  --
  -- A doctor writes on the visits booked to them, and on a visit nobody has
  -- been assigned to yet (an emergency that arrives before triage). Nurses are
  -- deliberately NOT restricted this way: taking vitals for whichever doctor is
  -- running late is the job. Admins are not restricted either -- somebody has
  -- to be able to correct a note attached to the wrong visit.
  --
  -- With no session there is no role, so has_role() yields null and this
  -- branch never fires: the service role, the seed and migrations pass
  -- straight through, exactly as they do in assert_clinical().
  -- ---------------------------------------------------------------------------
  if public.has_role('doctor')
     and v_visit.doctor_id is not null
     and v_visit.doctor_id is distinct from v_staff_id
  then
    raise exception 'That visit is booked to another doctor.'
      using errcode = '42501',
            hint    = 'Ask the front desk to reassign the visit if it should be yours.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The record. Found by visit, not by id: a visit is one encounter, so the
  -- second save of the morning has to edit the first rather than collide with
  -- the unique constraint.
  -- ---------------------------------------------------------------------------
  insert into public.consultations (
    id, hospital_id, visit_id, patient_id, doctor_id,
    bp_systolic, bp_diastolic, pulse, temperature_f, weight_kg, spo2,
    notes, created_by, updated_by
  )
  values (
    coalesce(v_id, gen_random_uuid()),
    v_hospital_id,
    v_visit.id,
    v_visit.patient_id,
    coalesce(v_visit.doctor_id, v_staff_id),
    (payload ->> 'bp_systolic')::smallint,
    (payload ->> 'bp_diastolic')::smallint,
    (payload ->> 'pulse')::smallint,
    (payload ->> 'temperature_f')::numeric(4,1),
    (payload ->> 'weight_kg')::numeric(5,2),
    (payload ->> 'spo2')::smallint,
    v_notes,
    (select auth.uid()),
    (select auth.uid())
  )
  on conflict on constraint consultations_hospital_id_visit_id_key do update
    set bp_systolic   = excluded.bp_systolic,
        bp_diastolic  = excluded.bp_diastolic,
        pulse         = excluded.pulse,
        temperature_f = excluded.temperature_f,
        weight_kg     = excluded.weight_kg,
        spo2          = excluded.spo2,
        notes         = excluded.notes,
        -- doctor_id follows the visit, in case the desk reassigned it since.
        doctor_id     = excluded.doctor_id,
        updated_by    = excluded.updated_by,
        updated_at    = now()
  returning * into v_row;

  -- ---------------------------------------------------------------------------
  -- And the queue.
  --
  -- 'completed' is the doctor saying they are done, and is what takes the
  -- patient off the board. 'in_consultation' only ever moves a waiting visit
  -- forward -- re-opening a completed visit to fix a spelling must not put the
  -- patient back in the queue an hour later.
  -- ---------------------------------------------------------------------------
  if (payload ->> 'visit_status') is not null then
    begin
      v_status := (payload ->> 'visit_status')::public.visit_status;
    exception when others then
      raise exception 'A consultation can only set a visit to in_consultation or completed.';
    end;

    if v_status = 'completed' then
      update public.visits
         set status = 'completed'
       where id = v_visit.id
         and hospital_id = v_hospital_id
         and status <> 'cancelled';

    elsif v_status = 'in_consultation' then
      update public.visits
         set status = 'in_consultation'
       where id = v_visit.id
         and hospital_id = v_hospital_id
         and status = 'waiting';

    else
      raise exception 'A consultation can only set a visit to in_consultation or completed.';
    end if;
  end if;

  return v_row;
end;
$$;

comment on function public.save_consultation(jsonb) is
  'Upserts the consultation for a visit (one row per visit) and optionally moves the visit status, in one transaction. Vitals are replaced, not merged.';

revoke execute on function public.save_consultation(jsonb) from public, anon;
grant execute on function public.save_consultation(jsonb) to authenticated;

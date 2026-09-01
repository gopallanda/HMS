-- =============================================================================
-- 20260902090500_prescriptions.sql
-- The prescription. For OPD it IS the deliverable.
--
-- WHY
--
-- prescription.create has been in the permission union since block 1 and
-- nothing implemented it. A patient walks out of an Indian OPD holding paper;
-- a doctor who has to hand-write that paper anyway will not open the
-- consultation screen at all -- and then the queue never advances, tokens stop
-- rotating, and the waiting count the front desk prints beside each doctor is
-- wrong by mid-morning. The prescription is what makes the screen worth
-- opening.
--
-- DELIBERATELY SMALL. This is not the pharmacy module (Phase 2):
--
--   * free text in every field, no drug master
--   * no stock, no dispensing, no interaction checking
--   * a jsonb ARRAY on the consultation, not a table
--
-- The array is the right shape here and would be the wrong shape in Phase 2.
-- What is stored is a document -- the lines as the doctor wrote them, in the
-- order they wrote them, printed once and read back as a whole. Nothing joins
-- to a prescription line, nothing aggregates one, and nothing will until there
-- is a drug master to join it TO. When Phase 2 arrives it brings drugs,
-- batches and a stock ledger, and these rows migrate into it with the text
-- they were written with. A table now would be a half-built version of that
-- one with no drug ids in it.
--
-- The CHECK below is what stops the array becoming a junk drawer: it must be
-- an array, every element must be an object, and every element must have a
-- non-empty drug name. Everything else about a line is optional, because
-- "Paracetamol 650, SOS" is a real prescription.
-- =============================================================================

alter table public.consultations
  add column prescription jsonb not null default '[]'::jsonb;

comment on column public.consultations.prescription is
  'The prescription as written, as an array of {drug, strength, dose, frequency, duration, notes}. Free text throughout -- no drug master, no stock, no dispensing (those are Phase 2). A document, not a join target.';

alter table public.consultations
  add constraint consultations_prescription_is_a_list
    check (jsonb_typeof(prescription) = 'array');

-- Every line names a drug. A line with a dose and no drug is a line nobody can
-- dispense and nobody can read back; it is the one field the form cannot let
-- through empty, and this is the half of that rule an RPC cannot bypass.
--
-- Through a function because a CHECK constraint may not contain a subquery
-- (SQLSTATE 0A000) and walking a jsonb array needs one. IMMUTABLE is honest
-- here: the answer depends on the argument and on nothing else -- no table, no
-- setting, no clock -- which is exactly what a constraint is allowed to lean
-- on. `strict` so a null array is null rather than false, and the constraint
-- then passes: the column is NOT NULL, so null is unreachable anyway.
create or replace function public.prescription_lines_are_valid(p_lines jsonb)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements(p_lines) as line
    where jsonb_typeof(line) <> 'object'
       or coalesce(btrim(line ->> 'drug'), '') = ''
  );
$$;

comment on function public.prescription_lines_are_valid(jsonb) is
  'Whether every element of a prescription array is an object naming a drug. Exists because a CHECK constraint cannot contain a subquery.';

alter table public.consultations
  add constraint consultations_prescription_lines_name_a_drug
    check (public.prescription_lines_are_valid(prescription));

-- Twenty lines is a generous ceiling for an OPD script and a cheap guard
-- against a runaway client posting a megabyte of jsonb into a clinical row.
alter table public.consultations
  add constraint consultations_prescription_length
    check (jsonb_array_length(prescription) <= 20);

-- =============================================================================
-- save_consultation writes it.
--
-- REPLACED, not merged, exactly like the vitals and for the same reason: the
-- form always posts the whole list, so a line the doctor deleted has to be
-- able to disappear. The header of 20260820120000 already says a partial
-- payload blanks what it omits; a prescription key that is ABSENT is the one
-- exception, and it has to be -- set_visit_status is not the only caller that
-- touches this row, and a consultation saved from a screen that does not know
-- about prescriptions must not wipe one.
--
-- So: `prescription` absent means leave it alone; `prescription` present means
-- this is the whole list now, including an empty one.
--
-- Everything else in this body is 20260820120000 unchanged.
-- =============================================================================
create or replace function public.save_consultation(payload jsonb)
returns public.consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id  uuid;
  v_id           uuid;
  v_visit_id     uuid;
  v_visit        public.visits;
  v_status       public.visit_status;
  v_staff_id     uuid := public.current_staff_id();
  v_notes        text;
  v_prescription jsonb;
  v_has_script   boolean;
  v_row          public.consultations;
begin
  v_hospital_id := public.rpc_hospital_id(nullif(payload ->> 'hospital_id', '')::uuid);
  perform public.assert_clinical();

  v_id       := nullif(payload ->> 'id', '')::uuid;
  v_visit_id := nullif(payload ->> 'visit_id', '')::uuid;
  v_notes    := nullif(btrim(coalesce(payload ->> 'notes', '')), '');

  -- Absent is different from empty. `payload ? 'prescription'` is the only way
  -- to tell them apart, and getting it wrong means a queue action erases a
  -- doctor's script.
  v_has_script := payload ? 'prescription' and jsonb_typeof(payload -> 'prescription') = 'array';
  v_prescription := case when v_has_script then payload -> 'prescription' else '[]'::jsonb end;

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

  -- A doctor writes on the visits booked to them, and on a visit nobody has
  -- been assigned to yet. Nurses and admins are deliberately not restricted.
  if public.has_role('doctor')
     and v_visit.doctor_id is not null
     and v_visit.doctor_id is distinct from v_staff_id
  then
    raise exception 'That visit is booked to another doctor.'
      using errcode = '42501',
            hint    = 'Ask the front desk to reassign the visit if it should be yours.';
  end if;

  insert into public.consultations (
    id, hospital_id, visit_id, patient_id, doctor_id,
    bp_systolic, bp_diastolic, pulse, temperature_f, weight_kg, spo2,
    notes, prescription, created_by, updated_by
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
    v_prescription,
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
        prescription  = case
                          when v_has_script then excluded.prescription
                          else public.consultations.prescription
                        end,
        doctor_id     = excluded.doctor_id,
        updated_by    = excluded.updated_by,
        updated_at    = now()
  returning * into v_row;

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
  'Upserts the consultation for a visit (one row per visit) and optionally moves the visit status, in one transaction. Vitals and notes are replaced, not merged. The prescription is replaced only when the payload carries the key, so a caller that does not know about prescriptions cannot erase one.';

revoke execute on function public.save_consultation(jsonb) from public, anon;
grant execute on function public.save_consultation(jsonb) to authenticated;

-- =============================================================================
-- log_document_print -- every trip to the printer stays audited (CLAUDE.md 7).
--
-- A SIBLING of log_receipt_print rather than an extra argument on it, because
-- the two do not check the same thing: one has to prove the INVOICE belongs to
-- this tenant, the other the VISIT. Folding both into one function would mean
-- a p_kind argument and a branch, and a caller that passes the wrong kind
-- would get an audit row pointing at a record that does not exist.
--
-- log_receipt_print keeps its signature and its behaviour untouched: it is
-- bound to afterprint on a route in production and a changed argument list is
-- a broken reprint.
--
-- Same synthetic-table_name trick, same reason: public.audit_action has three
-- values and adding a fourth needs two migrations for one word. 'insert' on
-- table_name 'prescription_print' says a print event was created, against this
-- visit, by this person, at this time.
-- =============================================================================
create or replace function public.log_document_print(
  p_visit_id uuid,
  p_kind     text default 'prescription',
  p_format   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_visit       public.visits;
  v_kind        text;
begin
  v_hospital_id := public.rpc_hospital_id(null);

  v_kind := lower(nullif(btrim(coalesce(p_kind, '')), ''));
  if v_kind is null or v_kind <> 'prescription' then
    raise exception 'Unknown document type.';
  end if;

  -- The visit must be ours. Without this the function is an oracle that says
  -- whether an id exists in another tenant, one audit row at a time.
  select v.* into v_visit
  from public.visits v
  where v.id = p_visit_id
    and v.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That visit does not exist here.'
      using errcode = '42501';
  end if;

  insert into public.audit_log (
    hospital_id, table_name, record_id, action, actor_id, before, after
  )
  values (
    v_hospital_id,
    'prescription_print',
    v_visit.id,
    'insert',
    auth.uid(),
    null,
    jsonb_build_object(
      'visit_id',  v_visit.id,
      'visit_no',  v_visit.visit_no,
      'token_no',  v_visit.token_no,
      'doctor_id', v_visit.doctor_id,
      'format',    coalesce(nullif(btrim(coalesce(p_format, '')), ''), 'unknown')
    )
  );
end;
$$;

comment on function public.log_document_print(uuid, text, text) is
  'Records that a clinical document was printed against a visit. Not a trigger: a print changes no row, so the application is the only thing that can report it. Sibling of log_receipt_print, which stays untouched.';

revoke execute on function public.log_document_print(uuid, text, text) from public, anon;
grant execute on function public.log_document_print(uuid, text, text) to authenticated;

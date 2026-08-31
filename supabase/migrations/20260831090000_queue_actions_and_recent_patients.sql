-- =============================================================================
-- 20260831090000_queue_actions_and_recent_patients.sql
--
-- Two functions, both fixing screens that had no way to say something true.
--
-- 1. set_visit_status -- the doctor moving a patient through the queue WITHOUT
--    opening the consultation form.
--
--    Until now the only thing that could move visits.status was
--    save_consultation, which is the right home for it when a note is being
--    written and the wrong one the rest of the time: an OPD doctor seeing
--    forty patients does not type on most of them, and a queue that only
--    advances when somebody writes a note is a queue that never advances. The
--    tokens then never rotate, the "waiting" count the register desk shows
--    against each doctor is wrong all day, and the front desk starts guessing.
--
--    It cannot be done by calling save_consultation with an empty payload:
--    that function REPLACES the vitals rather than merging them, so a
--    queue-level call would silently wipe the readings the nurse took before
--    the doctor walked in. Hence a function that touches the visit and nothing
--    else.
--
-- 2. recent_patients -- the resting state of /patients.
--
--    That screen was search-only, so an empty box rendered an empty state and
--    somebody who had just registered a patient opened the patients module and
--    found no patients in it. This is the same row shape search_patients
--    returns, so one component renders both.
--
-- Nothing in patients, visits, invoices, payments or charge_items changes
-- shape here (CLAUDE.md 10). No new table, no new column.
-- =============================================================================

-- =============================================================================
-- recent_patients(p_limit) -> the search row shape
--
-- SECURITY INVOKER, like search_patients and for the same reason: it is a
-- read, so patients_select_tenant is exactly the right guard and does the
-- tenant filtering.
--
-- Ordered by when the patient was last SEEN, not when their record was
-- created. "Who has been through here lately" is the question the screen is
-- standing in for, and a patient registered in April who came back this
-- morning belongs at the top of it. A record with no visit at all falls to the
-- end, ordered by its own creation -- which is where a freshly created record
-- with a failed visit would show up, and it should be visible rather than
-- silently absent.
-- =============================================================================
create or replace function public.recent_patients(p_limit int default 12)
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
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 12), 1), 50);
begin
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
  order by v.last_visit_at desc nulls last, p.created_at desc
  limit v_limit;
end;
$$;

comment on function public.recent_patients(int) is
  'The most recently seen patients in the caller''s hospital, in the same row shape as search_patients. Read-only, RLS applies. Backs the resting state of the patients screen.';

revoke execute on function public.recent_patients(int) from public, anon;
grant execute on function public.recent_patients(int) to authenticated;

-- =============================================================================
-- set_visit_status(p_visit_id, p_status, p_hospital_id) -> jsonb
--
-- The queue transition on its own. Vitals and notes are not mentioned here,
-- so nothing can be lost by pressing a button on a list.
--
-- Which moves are legal, and why these:
--
--   waiting          -> in_consultation   the doctor called them in
--   waiting          -> completed         seen and sent away with nothing to
--                                         write down. The common case in an
--                                         OPD, and the whole reason this
--                                         function exists.
--   in_consultation  -> completed         done
--   in_consultation  -> waiting           called the wrong token
--   completed        -> in_consultation   the patient came back through the
--                                         door before the next one was called
--
-- 'cancelled' is NOT reachable from here. Cancelling a visit is a front-desk
-- decision about money and a token somebody is holding a slip for, and it will
-- want its own reason -- exactly like void_invoice and transfer_visit. A
-- cancelled visit is likewise immovable: it is finished.
--
-- SECURITY DEFINER because the "is this your patient" rule below has to be the
-- database's answer rather than the application's, the same as it is in
-- save_consultation. visits_update_desk would let any doctor move any visit.
-- =============================================================================
create or replace function public.set_visit_status(
  p_visit_id    uuid,
  p_status      public.visit_status,
  p_hospital_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_visit       public.visits;
  v_staff_id    uuid := public.current_staff_id();
  v_row         public.visits;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_clinical();

  if p_visit_id is null then
    raise exception 'A queue action needs a visit.';
  end if;

  if p_status is null or p_status not in ('waiting', 'in_consultation', 'completed') then
    raise exception 'A visit can only be moved to waiting, in_consultation or completed here.'
      using hint = 'Cancelling a visit is a front-desk action and needs a reason.';
  end if;

  select v.* into v_visit
  from public.visits v
  where v.id = p_visit_id and v.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'That visit no longer exists.';
  end if;

  if v_visit.status = 'cancelled' then
    raise exception 'That visit was cancelled at the front desk, so it cannot be moved.';
  end if;

  -- Same rule, same words, as save_consultation: a doctor works their own
  -- queue and an unassigned emergency; nurses and admins are not narrowed,
  -- because running the queue for whoever is late is the job. With no session
  -- there is no role, so has_role() yields null and the service role, the seed
  -- and migrations pass straight through.
  if public.has_role('doctor')
     and v_visit.doctor_id is not null
     and v_visit.doctor_id is distinct from v_staff_id
  then
    raise exception 'That visit is booked to another doctor.'
      using errcode = '42501',
            hint    = 'Ask the front desk to transfer the visit if it should be yours.';
  end if;

  -- Idempotent on purpose. Two taps on a phone, or a Realtime refresh landing
  -- between the click and the POST, must not be an error a doctor has to read.
  if v_visit.status = p_status then
    v_row := v_visit;
  else
    update public.visits
       set status = p_status
     where id = v_visit.id
       and hospital_id = v_hospital_id
       and status <> 'cancelled'
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'visit_id',  v_row.id,
    'visit_no',  v_row.visit_no,
    'token_no',  v_row.token_no,
    'status',    v_row.status,
    'doctor_id', v_row.doctor_id
  );
end;
$$;

comment on function public.set_visit_status(uuid, public.visit_status, uuid) is
  'Moves a visit between waiting, in_consultation and completed without touching the consultation record. The queue action behind the doctor board. Cancellation is deliberately not reachable here.';

revoke execute on function public.set_visit_status(uuid, public.visit_status, uuid) from public, anon;
grant execute on function public.set_visit_status(uuid, public.visit_status, uuid) to authenticated;

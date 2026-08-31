-- =============================================================================
-- 20260829090200_transfer_visit.sql
-- Moving a waiting patient to a different doctor. Block 7.1.
--
-- WHY THIS EXISTS
--
-- Registration now sets the doctor, in the same transaction as the token and
-- the money, and there is no longer a screen that assigns one afterwards. That
-- closes defect 3 -- but it also removes the only way the desk had to fix a
-- wrong choice, and a wrong choice happens: the patient says orthopaedics and
-- means physiotherapy, or the doctor they asked for goes home sick at eleven.
--
-- So the correction becomes a deliberate act with a name, a reason and a
-- record, rather than an editable field. Three things have to happen together
-- or none of them:
--
--   1. the visit moves to the new doctor
--   2. it takes a NEW token, at the back of the new doctor's queue -- keeping
--      the old number would either collide with a real one or jump the patient
--      ahead of people who have been waiting longer
--   3. the reason is written down
--
-- The old token is NOT reused or released. Somebody in the waiting room is
-- holding a printed slip with it on, and handing the same number to the next
-- person registering is how two people answer one call.
-- =============================================================================

create table public.visit_transfers (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references public.hospitals(id),
  visit_id        uuid not null,
  from_doctor_id  uuid,
  to_doctor_id    uuid not null,
  from_token_no   integer not null,
  to_token_no     integer not null,
  reason          text not null check (length(btrim(reason)) >= 5),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint visit_transfers_visit_same_hospital_fkey
    foreign key (hospital_id, visit_id)
    references public.visits (hospital_id, id),
  constraint visit_transfers_to_doctor_same_hospital_fkey
    foreign key (hospital_id, to_doctor_id)
    references public.staff (hospital_id, id)
);

create index visit_transfers_hospital_id_visit_id_idx
  on public.visit_transfers (hospital_id, visit_id, created_at desc);

comment on table public.visit_transfers is
  'Every time a visit changed doctor, with the reason. No unique key on visit_id: a patient can legitimately be moved twice.';

alter table public.visit_transfers enable row level security;

-- Readable by the hospital, written only by transfer_visit(). Same arrangement
-- as charge_items and invoices: no insert, update or delete policy exists, so
-- the SECURITY DEFINER function below is the only writer (CLAUDE.md 3.2).
create policy visit_transfers_select_tenant on public.visit_transfers
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create trigger visit_transfers_audit
  after insert or update or delete on public.visit_transfers
  for each row execute function public.fn_audit();

-- =============================================================================
-- transfer_visit(p_visit_id, p_doctor_id, p_reason, p_department_id)
--
-- Returns the new token, because that is the only thing the desk has to say
-- out loud: "you are now number four for Dr Rao."
-- =============================================================================
create or replace function public.transfer_visit(
  p_visit_id      uuid,
  p_doctor_id     uuid,
  p_reason        text,
  p_department_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_visit       public.visits;
  v_doctor      public.staff;
  v_reason      text;
  v_day         date;
  v_token       int;
  v_department  uuid;
begin
  v_hospital_id := public.rpc_hospital_id(null);
  perform public.assert_front_desk();

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'Say why this patient is being moved.';
  end if;

  -- FOR UPDATE, so two clerks moving the same patient at once do it one after
  -- the other rather than both reading the same old token.
  select v.* into v_visit
  from public.visits v
  where v.id = p_visit_id and v.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'That visit no longer exists.';
  end if;
  if v_visit.status in ('completed', 'cancelled') then
    raise exception 'Visit % is already %, so it cannot be moved.',
      v_visit.visit_no, v_visit.status;
  end if;
  if v_visit.doctor_id is not distinct from p_doctor_id then
    raise exception 'That is already the doctor on this visit.';
  end if;

  select s.* into v_doctor
  from public.staff s
  where s.id = p_doctor_id and s.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That doctor is not on the staff list.';
  end if;
  if v_doctor.role <> 'doctor' then
    raise exception '% is not a doctor.', v_doctor.full_name;
  end if;
  if not v_doctor.is_active then
    raise exception '% is no longer active.', v_doctor.full_name;
  end if;

  v_department := coalesce(p_department_id, v_doctor.department_id);
  v_day        := public.ist_date(v_visit.visited_at);

  -- The same lock create_visit takes, on the same three values and in the same
  -- order, so a transfer and a registration into one doctor's queue serialise
  -- against each other instead of racing for a number.
  perform pg_advisory_xact_lock(
    hashtext(v_hospital_id::text || ':' || v_day::text || ':' || p_doctor_id::text)::bigint
  );

  select coalesce(max(v.token_no), 0) + 1
    into v_token
  from public.visits v
  where v.hospital_id = v_hospital_id
    and public.ist_date(v.visited_at) = v_day
    and v.doctor_id = p_doctor_id;

  insert into public.visit_transfers (
    hospital_id, visit_id, from_doctor_id, to_doctor_id,
    from_token_no, to_token_no, reason, created_by
  )
  values (
    v_hospital_id, v_visit.id, v_visit.doctor_id, p_doctor_id,
    v_visit.token_no, v_token, v_reason, auth.uid()
  );

  update public.visits
     set doctor_id     = p_doctor_id,
         department_id = v_department,
         token_no      = v_token
   where id = v_visit.id
     and hospital_id = v_hospital_id;

  return jsonb_build_object(
    'visit_id',    v_visit.id,
    'visit_no',    v_visit.visit_no,
    'token_no',    v_token,
    'doctor_id',   p_doctor_id,
    'doctor_name', v_doctor.full_name
  );
end;
$$;

comment on function public.transfer_visit(uuid, uuid, text, uuid) is
  'Moves a waiting visit to another doctor: new token at the back of their queue, reason recorded in visit_transfers. The old token is never reused.';

revoke execute on function public.transfer_visit(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.transfer_visit(uuid, uuid, text, uuid) to authenticated;

-- =============================================================================
-- Visits with no doctor -- the repair list. Block 7.2.
--
-- Registration cannot produce one any more, so every row this returns predates
-- this phase (or came in through create_visit's emergency path, where a
-- patient arrives before anybody knows who will see them). They are surfaced
-- rather than migrated: guessing a doctor for somebody else's historical data
-- writes a clinical record that is not true.
-- =============================================================================
create view public.incomplete_visits
with (security_invoker = on) as
select
  v.id,
  v.hospital_id,
  v.visit_no,
  v.token_no,
  v.status,
  v.visited_at,
  public.ist_date(v.visited_at) as visit_date,
  v.patient_id,
  p.mrn        as patient_mrn,
  p.full_name  as patient_name,
  p.dob        as patient_dob,
  p.gender     as patient_gender,
  p.phone      as patient_phone,
  d.name       as department_name,
  public.visit_payment_due(v.hospital_id, v.id) as payment_due
from public.visits v
join public.patients p
  on p.hospital_id = v.hospital_id and p.id = v.patient_id
left join public.departments d
  on d.hospital_id = v.hospital_id and d.id = v.department_id
where v.doctor_id is null
  and v.status not in ('completed', 'cancelled');

comment on view public.incomplete_visits is
  'Visits with no doctor, still open. The repair list for data that predates the one-transaction registration. security_invoker.';

grant select on public.incomplete_visits to authenticated;

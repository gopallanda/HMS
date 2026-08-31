-- =============================================================================
-- 20260829090300_rpc_hospital_argument.sql
-- transfer_visit and log_receipt_print gain p_hospital_id.
--
-- WHY
--
-- Both were written calling rpc_hospital_id(null), which is correct for a
-- signed-in caller -- the tenant comes from the JWT and a payload that
-- disagrees is refused (CLAUDE.md 3.1) -- and impossible for anybody else.
-- rpc_hospital_id raises 'hospital_id is required when there is no session'
-- when there is no claim AND no argument, so the service role could not call
-- either function at all.
--
-- That is not a hypothetical gap. Every other RPC in this schema takes the
-- argument (register_patient, create_visit, collect_payment, void_invoice,
-- register_patient_visit) precisely because seed.sql and the test suite are
-- service-role callers, and a function they cannot reach is a function nothing
-- proves. tests/register-patient-visit.test.mjs found this on transfer_visit.
--
-- The argument grants nothing to a session: rpc_hospital_id refuses a value
-- that disagrees with the claim rather than believing it.
--
-- Both are DROPped first rather than replaced. A default argument added to the
-- end is a new overload, and the existing four- and two-argument calls would
-- then be ambiguous.
-- =============================================================================

drop function if exists public.transfer_visit(uuid, uuid, text, uuid);

create or replace function public.transfer_visit(
  p_visit_id      uuid,
  p_doctor_id     uuid,
  p_reason        text,
  p_department_id uuid default null,
  p_hospital_id   uuid default null
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
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
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

comment on function public.transfer_visit(uuid, uuid, text, uuid, uuid) is
  'Moves a waiting visit to another doctor: new token at the back of their queue, reason recorded in visit_transfers. The old token is never reused.';

revoke execute on function public.transfer_visit(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.transfer_visit(uuid, uuid, text, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------

drop function if exists public.log_receipt_print(uuid, text);

create or replace function public.log_receipt_print(
  p_invoice_id  uuid,
  p_format      text default null,
  p_hospital_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_invoice     public.invoices;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);

  -- The invoice must be ours. Without this check the function is an oracle
  -- that says whether an id exists in another tenant, one audit row at a time.
  select i.* into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That invoice does not exist here.'
      using errcode = '42501';
  end if;

  insert into public.audit_log (
    hospital_id, table_name, record_id, action, actor_id, before, after
  )
  values (
    v_hospital_id,
    'receipt_print',
    v_invoice.id,
    'insert',
    auth.uid(),
    null,
    jsonb_build_object(
      'id',          v_invoice.id,
      'invoice_no',  v_invoice.invoice_no,
      'grand_total', v_invoice.grand_total,
      'format',      coalesce(nullif(btrim(coalesce(p_format, '')), ''), 'unknown')
    )
  );
end;
$$;

comment on function public.log_receipt_print(uuid, text, uuid) is
  'Records that a receipt was printed. Not a trigger: a print changes no row, so the application is the only thing that can report it.';

revoke execute on function public.log_receipt_print(uuid, text, uuid) from public, anon;
grant execute on function public.log_receipt_print(uuid, text, uuid) to authenticated;

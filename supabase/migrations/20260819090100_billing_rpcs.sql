-- =============================================================================
-- 20260819090100_billing_rpcs.sql
-- collect_payment, void_invoice, day_close_report.
--
-- CLAUDE.md 3.2 is the whole design brief for this file:
--
--   * No client or server-action code ever touches invoices, payments or
--     charge_items directly. Those tables have no insert or update policy at
--     all, so the only way in is through the SECURITY DEFINER functions here.
--   * collect_payment is the ONLY path that creates an invoice, and everything
--     it does happens in one transaction: raise the ad-hoc charges, lock the
--     lines, allocate the number, write the invoice, attach the lines, record
--     the payment. Any failure and none of it happened.
--   * The invoice number comes from number_series via SELECT ... FOR UPDATE
--     inside next_number(), never from a sequence. The lock is held until THIS
--     transaction ends, which is what makes two concurrent collections
--     impossible to give the same number -- see
--     tests/collect-payment-concurrency.test.mjs.
--   * Invoices are never deleted. void_invoice sets a status and a typed
--     reason; the number stays consumed and the row stays readable.
--
-- SECURITY DEFINER means RLS does not protect these bodies, so each one starts
-- by resolving the tenant from the JWT (rpc_hospital_id) and checking the
-- caller's role itself (assert_billing).
--
-- Error codes raised here, for the app to map (lib/supabase/errors.ts):
--   42501  cross-tenant access, or a role that may not do this
--   90002  a charge line has already been billed on another invoice -- the
--          losing side of two cashiers billing the same visit at once
-- Everything else is a plain raise: the message is written to be read by the
-- person at the counter, and describeDatabaseError passes it through.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- May the caller take money?
--
-- Null role means no session: service role, seed, migration, or the
-- concurrency test. Fine-grained permission logic lives in RPCs and server
-- code rather than in dozens of policies (CLAUDE.md 5), and this is the RPC
-- half of it. Keep in sync with BILLING_ROLES in lib/roles.ts and with the
-- select policies in 20260819090000.
-- -----------------------------------------------------------------------------
create or replace function public.assert_billing()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if public.app_role() is null then
    return;
  end if;

  if not public.has_role('super_admin', 'admin', 'cashier') then
    raise exception 'Only billing staff can raise invoices and take payments.'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.assert_billing() to authenticated;

-- =============================================================================
-- collect_payment(p_visit_id, p_items, p_mode, p_amount, p_reference) -> invoice
--
-- The five arguments CLAUDE.md 4 specifies, plus three that default to null so
-- the documented call still works:
--
--   p_invoice_id    uuid, optional -- client-generated (CLAUDE.md 7). A form
--                   resubmitted after a dropped connection returns the invoice
--                   it already created instead of billing the patient twice.
--                   This matters more here than anywhere else in the app.
--   p_hospital_id   uuid, required ONLY for service-role callers (seed, tests).
--                   A signed-in caller's tenant comes from the JWT, and a
--                   payload that disagrees is refused, not ignored.
--   p_collected_by  uuid, same -- who took the money. For a signed-in caller
--                   this is auth.uid() and cannot be overridden: a cashier may
--                   not record a collection against somebody else's name.
--
-- p_items is a jsonb array. Two shapes, told apart by charge_item_id:
--
--   {"charge_item_id": "<uuid>"}
--       Bill a charge that is already pending on the visit -- the consultation
--       fee create_visit raised, a lab charge, anything.
--
--   {"service_id": "<uuid>", "qty": 1, "unit_price": 300, "description": "..."}
--       Raise a new charge and bill it in the same breath. service_id is
--       REQUIRED: the tax rate comes from the charge master and nowhere else
--       (CLAUDE.md 8), and a free-text line would be invisible to every report
--       the hospital later wants. qty defaults to 1, unit_price to the service
--       price (editable at the counter), description to the service name.
--
-- An empty selection is refused rather than producing a zero-value invoice
-- with a real number on it.
-- =============================================================================
create or replace function public.collect_payment(
  p_visit_id     uuid,
  p_items        jsonb,
  p_mode         public.payment_mode default null,
  p_amount       numeric default 0,
  p_reference    text default null,
  p_invoice_id   uuid default null,
  p_hospital_id  uuid default null,
  p_collected_by uuid default null
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id  uuid;
  v_actor        uuid := auth.uid();
  v_collected_by uuid;
  v_visit        public.visits;
  v_patient      public.patients;
  v_invoice      public.invoices;
  v_service      public.services;
  v_charge       public.charge_items;
  v_item         jsonb;
  v_ids          uuid[] := '{}';
  v_new_id       uuid;
  v_service_id   uuid;
  v_qty          numeric(10,2);
  v_unit_price   numeric(12,2);
  v_amount_line  numeric(12,2);
  v_description  text;
  v_subtotal     numeric(12,2) := 0;
  v_tax_total    numeric(12,2) := 0;
  v_grand_total  numeric(12,2);
  v_paid         numeric(12,2);
  v_status       public.invoice_status;
  v_invoice_no   text;
  v_reference    text;
  v_found        int := 0;
  v_expected     int;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_billing();

  -- ---------------------------------------------------------------------------
  -- Idempotency first, before any validation: a retry must return the invoice
  -- that already exists even if a rule has changed since it was written.
  -- ---------------------------------------------------------------------------
  if p_invoice_id is not null then
    select i.* into v_invoice
    from public.invoices i
    where i.id = p_invoice_id and i.hospital_id = v_hospital_id;

    if found then
      return v_invoice;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Who is collecting. Required, not nullable (CLAUDE.md 3.2).
  -- ---------------------------------------------------------------------------
  if v_actor is not null then
    if p_collected_by is not null and p_collected_by <> v_actor then
      raise exception 'A payment is recorded against the person who took it.'
        using errcode = '42501';
    end if;
    v_collected_by := v_actor;
  else
    v_collected_by := p_collected_by;
  end if;

  -- ---------------------------------------------------------------------------
  -- The visit. The composite foreign keys already pin the tenant; this is here
  -- to produce a sentence instead of a constraint name.
  -- ---------------------------------------------------------------------------
  if p_visit_id is null then
    raise exception 'Choose a visit to bill.';
  end if;

  select v.* into v_visit
  from public.visits v
  where v.id = p_visit_id and v.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That visit no longer exists.';
  end if;
  if v_visit.status = 'cancelled' then
    raise exception 'Visit % was cancelled, so it cannot be billed.', v_visit.visit_no;
  end if;

  select p.* into v_patient
  from public.patients p
  where p.id = v_visit.patient_id and p.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That patient record no longer exists.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The lines.
  --
  -- Ad-hoc charges are written first, as ordinary pending charge_items, so
  -- everything below treats them identically to a charge the desk or the lab
  -- raised earlier. They are visible to this transaction immediately and to
  -- nobody else until it commits.
  -- ---------------------------------------------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Nothing was selected to bill.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if nullif(v_item ->> 'charge_item_id', '') is not null then
      v_ids := v_ids || (v_item ->> 'charge_item_id')::uuid;
      continue;
    end if;

    v_service_id := nullif(v_item ->> 'service_id', '')::uuid;
    if v_service_id is null then
      raise exception 'A new charge has to come from the service list.';
    end if;

    select s.* into v_service
    from public.services s
    where s.id = v_service_id
      and s.hospital_id = v_hospital_id
      and s.is_active;

    if not found then
      raise exception 'That service is not on the charge master any more.';
    end if;

    v_qty := coalesce(nullif(v_item ->> 'qty', '')::numeric, 1);
    if v_qty <= 0 then
      raise exception 'Quantity for % has to be more than zero.', v_service.name;
    end if;

    -- The price pre-fills from the charge master and stays editable at the
    -- counter, which is the point of the screen -- but the TAX rate does not.
    -- That belongs to the service (CLAUDE.md 8).
    v_unit_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_service.price);
    if v_unit_price < 0 then
      raise exception 'The price for % cannot be negative.', v_service.name;
    end if;

    -- Assigned through the typed variables above first, so the rounding here
    -- matches what the numeric(10,2)/numeric(12,2) columns will hold and the
    -- charge_items_amount_matches_line check cannot trip on a half-paisa.
    v_amount_line := round(v_qty * v_unit_price, 2);
    v_description := coalesce(nullif(btrim(v_item ->> 'description'), ''), v_service.name);

    insert into public.charge_items (
      hospital_id, visit_id, service_id, description,
      qty, unit_price, amount, tax_rate,
      source_module, status, created_by
    )
    values (
      v_hospital_id, p_visit_id, v_service.id, v_description,
      v_qty, v_unit_price, v_amount_line, v_service.tax_rate,
      'billing', 'pending', v_actor
    )
    returning id into v_new_id;

    v_ids := v_ids || v_new_id;
  end loop;

  -- The same charge sent twice is one charge, not a doubled bill.
  select array_agg(distinct x) into v_ids from unnest(v_ids) x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Nothing was selected to bill.';
  end if;
  v_expected := array_length(v_ids, 1);

  -- ---------------------------------------------------------------------------
  -- Lock the lines, then total them.
  --
  -- FOR UPDATE is what stops two cashiers billing the same visit at the same
  -- moment from each attaching the consultation fee to their own invoice: the
  -- second one blocks here, and when it wakes up the row says 'invoiced' and
  -- it raises 90002 instead of charging the patient twice.
  --
  -- Ordered by id so that two calls with overlapping selections always take
  -- the locks in the same order and cannot deadlock. Note the ordering of the
  -- two lock kinds in this function as a whole: charge lines first, the
  -- number_series row second (inside next_number, below). Every caller does it
  -- in that order. Reversing it anywhere would reintroduce the deadlock this
  -- avoids.
  -- ---------------------------------------------------------------------------
  for v_charge in
    select ci.*
    from public.charge_items ci
    where ci.hospital_id = v_hospital_id
      and ci.id = any(v_ids)
    order by ci.id
    for update
  loop
    v_found := v_found + 1;

    if v_charge.visit_id <> p_visit_id then
      raise exception 'A charge on the bill belongs to a different visit.';
    end if;
    if v_charge.status = 'invoiced' then
      raise exception '% has already been billed.', v_charge.description
        using errcode = '90002',
              hint = 'Someone else billed this visit a moment ago. Reload the visit and start again.';
    end if;
    if v_charge.status = 'cancelled' then
      raise exception '% was cancelled and cannot be billed.', v_charge.description;
    end if;

    v_subtotal  := v_subtotal + v_charge.amount;
    -- Tax per line, never a blanket rate across the invoice (CLAUDE.md 8).
    -- Hospital services are usually exempt; the pharmacy line next to them is
    -- not, and both are on this bill.
    v_tax_total := v_tax_total + round(v_charge.amount * v_charge.tax_rate / 100, 2);
  end loop;

  if v_found <> v_expected then
    raise exception 'One of the charges on this bill no longer exists. Reload the visit.';
  end if;

  v_grand_total := v_subtotal + v_tax_total;

  -- ---------------------------------------------------------------------------
  -- The money.
  --
  -- An amount larger than the bill is refused rather than banked: the change
  -- handed back over the counter is not a payment, and recording it as one
  -- makes the drawer disagree with the report at closing time.
  -- ---------------------------------------------------------------------------
  v_paid := round(coalesce(p_amount, 0), 2);

  if v_paid < 0 then
    raise exception 'A payment cannot be negative.';
  end if;
  if v_paid > v_grand_total then
    raise exception 'That is more than the bill of %. Enter the amount actually collected.',
      to_char(v_grand_total, 'FM999999990.00');
  end if;
  if v_paid > 0 then
    if p_mode is null then
      raise exception 'Record how the payment was made: cash, UPI, card or other.';
    end if;
    if v_collected_by is null then
      raise exception 'A payment has to record who collected it.';
    end if;
  end if;

  v_status := case
    when v_paid >= v_grand_total then 'paid'
    when v_paid > 0              then 'partial'
    else                              'unpaid'
  end;

  -- ---------------------------------------------------------------------------
  -- The number, then the invoice.
  --
  -- next_number holds the number_series row lock until THIS transaction ends,
  -- so it is taken as late as possible -- every other cashier in the hospital
  -- waits behind it. A failure after this point returns the number instead of
  -- burning it, which is why an invoice book from this system has no holes.
  -- ---------------------------------------------------------------------------
  v_invoice_no := public.next_number(v_hospital_id, 'invoice');
  v_reference  := nullif(btrim(coalesce(p_reference, '')), '');

  insert into public.invoices (
    id, hospital_id, invoice_no, fy, visit_id, patient_id,
    patient_name_snapshot, subtotal, tax_total, grand_total, status, created_by
  )
  values (
    coalesce(p_invoice_id, gen_random_uuid()),
    v_hospital_id,
    v_invoice_no,
    public.financial_year(),
    p_visit_id,
    v_patient.id,
    v_patient.full_name,
    v_subtotal,
    v_tax_total,
    v_grand_total,
    v_status,
    v_actor
  )
  returning * into v_invoice;

  update public.charge_items ci
     set invoice_id = v_invoice.id,
         status     = 'invoiced'
   where ci.hospital_id = v_hospital_id
     and ci.id = any(v_ids);

  if v_paid > 0 then
    insert into public.payments (
      hospital_id, invoice_id, amount, mode, reference, collected_by
    )
    values (
      v_hospital_id, v_invoice.id, v_paid, p_mode, v_reference, v_collected_by
    );
  end if;

  return v_invoice;
end;
$$;

comment on function public.collect_payment(uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid) is
  'The only path that creates an invoice. One transaction: raise ad-hoc charges, lock and total the lines, allocate the number from number_series, write the invoice, attach the lines, record the payment. Idempotent on a client-supplied p_invoice_id.';

revoke execute on function public.collect_payment(uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.collect_payment(uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid)
  to authenticated;

-- =============================================================================
-- void_invoice(p_invoice_id, p_reason) -> void
--
-- CLAUDE.md 4: sets status = void, releases the charge_items back to pending,
-- never deletes. The invoice number stays consumed -- a gap in an invoice book
-- is an audit question, a voided invoice with a reason on it is an answer.
--
-- It also reverses the invoice's payments, with the same reason. That is not
-- in the one-line spec, but the alternative is a voided bill whose money is
-- still counted in the day-close report, and a cashier who cannot make the
-- drawer agree with the screen. is_reversed exists on payments for exactly
-- this. Reversing does not move any cash: the refund happens at the counter,
-- and this is the record of it.
--
-- POLICY DECISION: billing staff may void, not only admins. A same-day
-- correction is the common case, and an invoice a cashier cannot fix at 9pm is
-- a day that cannot be closed. Every void is in audit_log with the actor and
-- the reason, and it shows on the day-close report. Tighten the role check
-- here if a hospital wants voids to need a supervisor.
-- =============================================================================
create or replace function public.void_invoice(
  p_invoice_id  uuid,
  p_reason      text,
  -- Required only for service-role callers (seed, admin scripts), exactly as
  -- in collect_payment. A signed-in caller's tenant comes from the JWT and a
  -- payload that disagrees is refused.
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
  v_reason      text;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_billing();

  -- A typed reason, not a confirm dialog (CLAUDE.md 7). Enforced here as well
  -- as in the form, because an RPC is reachable without the form.
  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 4 then
    raise exception 'Say why this invoice is being voided.';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'That invoice no longer exists.';
  end if;
  if v_invoice.status = 'void' then
    raise exception 'Invoice % is already void.', v_invoice.invoice_no
      using detail = coalesce(v_invoice.void_reason, '');
  end if;

  update public.invoices i
     set status      = 'void',
         void_reason = v_reason
   where i.id = v_invoice.id;

  -- Back to unbilled, so the visit can be re-billed correctly. The lines
  -- themselves are untouched history: same rows, same amounts.
  update public.charge_items ci
     set status     = 'pending',
         invoice_id = null
   where ci.hospital_id = v_hospital_id
     and ci.invoice_id = v_invoice.id
     and ci.status = 'invoiced';

  update public.payments pm
     set is_reversed     = true,
         reversal_reason = v_reason
   where pm.hospital_id = v_hospital_id
     and pm.invoice_id = v_invoice.id
     and not pm.is_reversed;
end;
$$;

comment on function public.void_invoice(uuid, text, uuid) is
  'Voids an invoice with a typed reason: status = void, charge lines released to pending, payments reversed. Never deletes, and the invoice number stays consumed.';

revoke execute on function public.void_invoice(uuid, text, uuid) from public, anon;
grant execute on function public.void_invoice(uuid, text, uuid) to authenticated;

-- =============================================================================
-- day_close_report(p_hospital_id, p_date) -> table
--
-- Read-only (CLAUDE.md 4). SECURITY INVOKER, unlike everything else in this
-- file: a report is a read, so RLS is exactly the right guard and the select
-- policies on invoices and payments do the tenant filtering for free.
--
-- Shape: one long table with a `bucket` discriminator rather than three
-- functions, so the screen makes one round trip and the totals are guaranteed
-- to come from the same snapshot of the day.
--
--   bucket 'total'       collected / invoiced / voided for the day
--   bucket 'mode'        collections by cash, upi, card, other
--   bucket 'staff'       collections by the person who took the money
--   bucket 'department'  collections by the department of the visit billed
--
-- Reversed payments are excluded everywhere: money that was refunded is not
-- money in the drawer. All four payment modes are always returned, even at
-- zero, so the sheet has the same shape every day and an empty row is visible
-- rather than absent.
--
-- The day is the IST calendar day (public.ist_date), never the server's.
-- =============================================================================
create or replace function public.day_close_report(
  p_hospital_id uuid,
  p_date        date default null
)
returns table (
  bucket      text,
  key         text,
  label       text,
  entry_count bigint,
  amount      numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hospital_id uuid;
  v_date        date;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  v_date        := coalesce(p_date, public.ist_date(now()));

  return query
  with paid as (
    select
      pm.amount,
      pm.mode,
      pm.collected_by,
      i.visit_id
    from public.payments pm
    join public.invoices i
      on i.hospital_id = pm.hospital_id and i.id = pm.invoice_id
    where pm.hospital_id = v_hospital_id
      and not pm.is_reversed
      and public.ist_date(pm.paid_at) = v_date
  ),
  billed as (
    select i.status, i.grand_total
    from public.invoices i
    where i.hospital_id = v_hospital_id
      and public.ist_date(i.invoice_date) = v_date
  )

  -- ---------------------------------------------------------------------------
  -- Totals
  -- ---------------------------------------------------------------------------
  select
    'total'::text,
    'collected'::text,
    'Collected'::text,
    count(*)::bigint,
    coalesce(sum(p.amount), 0)::numeric
  from paid p

  union all
  select
    'total', 'invoiced', 'Billed',
    count(*)::bigint,
    coalesce(sum(b.grand_total), 0)::numeric
  from billed b
  where b.status <> 'void'

  union all
  select
    'total', 'voided', 'Voided',
    count(*)::bigint,
    coalesce(sum(b.grand_total), 0)::numeric
  from billed b
  where b.status = 'void'

  -- ---------------------------------------------------------------------------
  -- By payment mode -- which drawer, which settlement account
  -- ---------------------------------------------------------------------------
  union all
  select
    'mode',
    m.mode::text,
    -- The screen labels these from lib/billing.ts. This is what the report
    -- reads as when it is run straight from SQL, which is how a hospital's
    -- accountant will eventually run it.
    case m.mode
      when 'cash'  then 'Cash'
      when 'upi'   then 'UPI'
      when 'card'  then 'Card'
      when 'other' then 'Other'
    end,
    count(p.amount)::bigint,
    coalesce(sum(p.amount), 0)::numeric
  from unnest(enum_range(null::public.payment_mode)) as m(mode)
  left join paid p on p.mode = m.mode
  group by m.mode

  -- ---------------------------------------------------------------------------
  -- By staff -- who is handing over what at the end of the shift.
  --
  -- Joined to staff by user_id, so this reads as a name. A login with no staff
  -- record still gets its own row rather than being folded into someone
  -- else's.
  -- ---------------------------------------------------------------------------
  union all
  select
    'staff',
    p.collected_by::text,
    coalesce(max(s.full_name), 'Login with no staff record'),
    count(*)::bigint,
    sum(p.amount)::numeric
  from paid p
  left join public.staff s
    on s.hospital_id = v_hospital_id and s.user_id = p.collected_by
  group by p.collected_by

  -- ---------------------------------------------------------------------------
  -- By department -- the visit's department, since that is where the work was
  -- done. A visit with no department (an emergency registered before anyone
  -- was assigned) gets its own row rather than vanishing from the total.
  -- ---------------------------------------------------------------------------
  union all
  select
    'department',
    coalesce(v.department_id::text, 'none'),
    coalesce(max(d.name), 'No department'),
    count(*)::bigint,
    sum(p.amount)::numeric
  from paid p
  join public.visits v
    on v.hospital_id = v_hospital_id and v.id = p.visit_id
  left join public.departments d
    on d.hospital_id = v_hospital_id and d.id = v.department_id
  group by v.department_id;
end;
$$;

comment on function public.day_close_report(uuid, date) is
  'Read-only day close for one IST day: totals, plus collections by payment mode, by collecting staff and by department. Excludes reversed payments.';

revoke execute on function public.day_close_report(uuid, date) from public, anon;
grant execute on function public.day_close_report(uuid, date) to authenticated;

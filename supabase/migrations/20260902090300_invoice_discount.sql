-- =============================================================================
-- 20260902090300_invoice_discount.sql
-- A concession at the counter, recorded as a concession.
--
-- WHY
--
-- Every Indian clinic gives them: staff, camp, senior citizen, the doctor's
-- discretion for a family that cannot pay the whole fee. Until now the only
-- route was editing unit_price on an ad-hoc line at the collect desk, which
-- destroys the one fact worth keeping -- that it WAS a concession, how much,
-- and on whose say-so. A month of that and nobody can answer "how much are we
-- giving away", which is the question an owner actually asks.
--
-- INVOICE LEVEL, APPLIED AFTER TAX, WITH A REQUIRED REASON
--
-- Line-level pre-tax discount is a GST question and it is deliberately out of
-- the MVP: hospital services are largely exempt anyway (CLAUDE.md 8), so a
-- discount that changes the taxable value would be arithmetic in aid of
-- nothing. After tax, one figure, one reason, one line on the bill.
--
-- SCHEMA CHANGE ON public.invoices
--
-- CLAUDE.md 10 says stop and ask before changing the shape of a money table.
-- This one was asked for and signed off explicitly, and it is confined to two
-- new columns and the total check:
--
--   grand_total = subtotal + tax_total            becomes
--   grand_total = subtotal + tax_total - discount_amount
--
-- Every existing row has discount_amount 0, so the amended check holds over
-- the whole table without a backfill.
-- =============================================================================

alter table public.invoices
  add column discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0),
  add column discount_reason text;

comment on column public.invoices.discount_amount is
  'A concession given at the counter, applied AFTER tax. Zero on almost every bill. Never a way to correct a price -- that is an edit to the line.';
comment on column public.invoices.discount_reason is
  'Why the concession was given. Required whenever discount_amount > 0 and printed on the bill: this is the field that makes a discount auditable rather than a hole.';

-- Same rule as invoices_void_has_reason and payments_reversal_has_reason: a
-- concession with no reason does not exist, and a reason with no concession is
-- noise. Not an exact `=` pairing, though -- a reason typed into the box and
-- then the amount cleared back to zero should save as a plain bill, not fail.
alter table public.invoices
  add constraint invoices_discount_has_reason
    check (discount_amount = 0 or discount_reason is not null);

-- A discount cannot exceed the bill. Not merely because grand_total >= 0 is
-- already checked -- that would let 500 off a 400 bill land as an error about
-- a negative total, which tells the cashier nothing about what they did.
alter table public.invoices
  add constraint invoices_discount_within_total
    check (discount_amount <= subtotal + tax_total);

alter table public.invoices
  drop constraint invoices_grand_total_matches;

alter table public.invoices
  add constraint invoices_grand_total_matches
    check (grand_total = subtotal + tax_total - discount_amount);

-- =============================================================================
-- invoice_summary carries the two new columns.
--
-- Rebuilt rather than altered: a view's column list cannot be extended in
-- place. Everything else about it is 20260819090000 unchanged.
-- =============================================================================
drop view if exists public.invoice_summary;

create view public.invoice_summary
with (security_invoker = on) as
select
  i.id,
  i.hospital_id,
  i.invoice_no,
  i.fy,
  i.invoice_date,
  public.ist_date(i.invoice_date)   as invoice_day,
  i.status,
  i.void_reason,
  i.subtotal,
  i.tax_total,
  i.discount_amount,
  i.discount_reason,
  i.grand_total,
  i.patient_id,
  i.patient_name_snapshot,
  p.mrn                             as patient_mrn,
  p.full_name                       as patient_name,
  p.phone                           as patient_phone,
  i.visit_id,
  v.visit_no,
  v.token_no,
  v.doctor_id,
  s.full_name                       as doctor_name,
  v.department_id,
  d.name                            as department_name,
  coalesce(pay.paid_total, 0)       as paid_total,
  i.grand_total - coalesce(pay.paid_total, 0) as balance,
  coalesce(pay.payment_count, 0)    as payment_count,
  pay.modes                         as payment_modes,
  i.created_by,
  st.full_name                      as created_by_name
from public.invoices i
join public.patients p
  on p.hospital_id = i.hospital_id and p.id = i.patient_id
join public.visits v
  on v.hospital_id = i.hospital_id and v.id = i.visit_id
left join public.staff s
  on s.hospital_id = v.hospital_id and s.id = v.doctor_id
left join public.departments d
  on d.hospital_id = v.hospital_id and d.id = v.department_id
left join public.staff st
  on st.hospital_id = i.hospital_id and st.user_id = i.created_by
left join lateral (
  select
    sum(pm.amount)                    as paid_total,
    count(*)                          as payment_count,
    array_agg(distinct pm.mode::text) as modes
  from public.payments pm
  where pm.hospital_id = i.hospital_id
    and pm.invoice_id = i.id
    and not pm.is_reversed
) pay on true;

comment on view public.invoice_summary is
  'Invoice with its patient, visit, concession and the money collected so far. paid_total excludes reversed payments, so balance is what is actually outstanding.';

grant select on public.invoice_summary to authenticated;

-- =============================================================================
-- collect_payment gains p_discount and p_discount_reason.
--
-- DROPPED and recreated rather than replaced. A default argument added to the
-- end of an existing function is a new OVERLOAD, and every existing eight
-- argument call -- register_patient_visit's included -- would then be
-- ambiguous. Same reasoning as 20260829090300.
--
-- Both new arguments default, so register_patient_visit's call is unchanged
-- and a registration keeps taking the fee in full. A concession at the
-- register desk is deliberately not on offer: that screen exists to be fast
-- for the ninety per cent who simply pay, and a discount is a billing-counter
-- conversation.
--
-- Everything else in this body is 20260819090100 unchanged; it is repeated in
-- full because CREATE FUNCTION takes a whole body.
-- =============================================================================
drop function if exists public.collect_payment(
  uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid
);

create or replace function public.collect_payment(
  p_visit_id        uuid,
  p_items           jsonb,
  p_mode            public.payment_mode default null,
  p_amount          numeric default 0,
  p_reference       text default null,
  p_invoice_id      uuid default null,
  p_hospital_id     uuid default null,
  p_collected_by    uuid default null,
  p_discount        numeric default 0,
  p_discount_reason text default null
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
  v_gross        numeric(12,2);
  v_discount     numeric(12,2);
  v_reason       text;
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

  -- Idempotency first, before any validation: a retry must return the invoice
  -- that already exists even if a rule has changed since it was written.
  if p_invoice_id is not null then
    select i.* into v_invoice
    from public.invoices i
    where i.id = p_invoice_id and i.hospital_id = v_hospital_id;

    if found then
      return v_invoice;
    end if;
  end if;

  -- Who is collecting. Required, not nullable (CLAUDE.md 3.2).
  if v_actor is not null then
    if p_collected_by is not null and p_collected_by <> v_actor then
      raise exception 'A payment is recorded against the person who took it.'
        using errcode = '42501';
    end if;
    v_collected_by := v_actor;
  else
    v_collected_by := p_collected_by;
  end if;

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

  -- The lines. Ad-hoc charges are written first, as ordinary pending
  -- charge_items, so everything below treats them identically to a charge the
  -- desk or the lab raised earlier.
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

    v_unit_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_service.price);
    if v_unit_price < 0 then
      raise exception 'The price for % cannot be negative.', v_service.name;
    end if;

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

  select array_agg(distinct x) into v_ids from unnest(v_ids) x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Nothing was selected to bill.';
  end if;
  v_expected := array_length(v_ids, 1);

  -- Lock the lines, then total them. Ordered by id so two calls with
  -- overlapping selections take the locks in the same order. Charge lines
  -- first, the number_series row second (inside next_number, below): every
  -- caller does it in that order.
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
    v_tax_total := v_tax_total + round(v_charge.amount * v_charge.tax_rate / 100, 2);
  end loop;

  if v_found <> v_expected then
    raise exception 'One of the charges on this bill no longer exists. Reload the visit.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The concession.
  --
  -- After tax, on the whole bill, with a reason. The reason is required here
  -- as well as on the form and in the check constraint, because an RPC answers
  -- a POST without the form -- and because a concession with no reason is
  -- indistinguishable from a mis-key six weeks later.
  -- ---------------------------------------------------------------------------
  v_gross    := v_subtotal + v_tax_total;
  v_discount := round(coalesce(p_discount, 0), 2);
  v_reason   := nullif(btrim(coalesce(p_discount_reason, '')), '');

  if v_discount < 0 then
    raise exception 'A discount cannot be negative.';
  end if;
  if v_discount > 0 then
    if v_reason is null or length(v_reason) < 4 then
      raise exception 'Say why this concession is being given.';
    end if;
    if v_discount > v_gross then
      raise exception 'A discount of % is more than the bill of %.',
        to_char(v_discount, 'FM999999990.00'), to_char(v_gross, 'FM999999990.00');
    end if;
  else
    -- A reason typed and then the amount cleared is a plain bill, not an
    -- error. The column is nulled so the constraint and the print agree.
    v_reason := null;
  end if;

  v_grand_total := v_gross - v_discount;

  -- The money. An amount larger than the bill is refused rather than banked.
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

  -- The number, then the invoice. next_number holds the number_series row lock
  -- until THIS transaction ends, so it is taken as late as possible.
  v_invoice_no := public.next_number(v_hospital_id, 'invoice');
  v_reference  := nullif(btrim(coalesce(p_reference, '')), '');

  insert into public.invoices (
    id, hospital_id, invoice_no, fy, visit_id, patient_id,
    patient_name_snapshot, subtotal, tax_total,
    discount_amount, discount_reason, grand_total, status, created_by
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
    v_discount,
    v_reason,
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

comment on function public.collect_payment(
  uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid, numeric, text
) is
  'The only path that creates an invoice. One transaction: raise ad-hoc charges, lock and total the lines, apply any concession after tax, allocate the number from number_series, write the invoice, attach the lines, record the payment. Idempotent on a client-supplied p_invoice_id.';

revoke execute on function public.collect_payment(
  uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid, numeric, text
) from public, anon;
grant execute on function public.collect_payment(
  uuid, jsonb, public.payment_mode, numeric, text, uuid, uuid, uuid, numeric, text
) to authenticated;

-- =============================================================================
-- 20260902090000_add_payment.sql
-- add_payment(): money against an invoice that already exists.
--
-- WHAT WAS WRONG
--
-- collect_payment is the only function that writes an invoice, and it ALWAYS
-- allocates a number and inserts a new row. Nothing anywhere could add a
-- payment to a bill that had already been raised. Three consequences, all of
-- them money the hospital could not reach:
--
--   * register_patient_visit calls collect_payment with p_amount => 0 on the
--     deferred path (20260829090000). That writes an `unpaid` invoice and
--     flips the consultation charge to `invoiced`. The collect desk keys its
--     row off visit_billing.pending_count, which is then 0, so the visit
--     renders as billed with nothing to do and the cashier has no button.
--     Every deferred rupee was unreachable.
--   * `partial` was a one-way door. Nothing could top it up, so a patient who
--     paid half stayed half paid forever.
--   * PAYMENT DUE is advertised on the front-desk queue, the incomplete list,
--     the doctor's visit header, the patient money panel and the printed
--     receipt, and no screen in the product could clear it.
--
-- WHAT THIS IS NOT
--
-- It is not a second way to create an invoice. collect_payment remains the
-- only path that draws an invoice number (CLAUDE.md 3.2), and this function
-- refuses to write anything if the invoice is not already there. It does not
-- touch charge_items either: the lines were attached when the bill was raised,
-- and paying for them later does not change what was billed.
--
-- SIGNATURE NOTE
--
-- p_collected_by is not in the specified argument list but is required for the
-- same reason collect_payment has one: payments.collected_by is NOT NULL, and
-- the seed and the test suite are service-role callers with no auth.uid(). For
-- a signed-in caller it is refused unless it agrees with the JWT, so it grants
-- nothing -- exactly as in collect_payment.
-- =============================================================================

create or replace function public.add_payment(
  p_invoice_id   uuid,
  p_amount       numeric,
  p_mode         public.payment_mode,
  p_reference    text default null,
  p_hospital_id  uuid default null,
  -- Client-generated (CLAUDE.md 7). A dialog resubmitted after a dropped
  -- connection returns the invoice as it already stands instead of banking the
  -- same rupees twice. This matters more here than anywhere but collect_payment.
  p_payment_id   uuid default null,
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
  v_invoice      public.invoices;
  v_amount       numeric(12,2);
  v_paid         numeric(12,2);
  v_balance      numeric(12,2);
  v_status       public.invoice_status;
  v_reference    text;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_billing();

  -- ---------------------------------------------------------------------------
  -- Idempotency first, before any validation: a retry must return what was
  -- already written even if a rule has changed since -- and even if the
  -- invoice is now fully paid, which is exactly what the first attempt did.
  -- ---------------------------------------------------------------------------
  if p_payment_id is not null then
    perform 1
    from public.payments pm
    where pm.id = p_payment_id and pm.hospital_id = v_hospital_id;

    if found then
      select i.* into v_invoice
      from public.invoices i
      where i.id = p_invoice_id and i.hospital_id = v_hospital_id;

      if not found then
        raise exception 'That invoice no longer exists.';
      end if;
      return v_invoice;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Who is collecting. Required, not nullable (CLAUDE.md 3.2), and never taken
  -- from the payload for a signed-in caller.
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
  -- The invoice, locked.
  --
  -- FOR UPDATE is what stops two cashiers at two windows each reading a
  -- balance of 300 and each banking 300 against a 300 rupee bill. The second
  -- one blocks here, and when it wakes the balance it reads is the real one.
  -- ---------------------------------------------------------------------------
  if p_invoice_id is null then
    raise exception 'Choose an invoice to collect against.';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.id = p_invoice_id and i.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'That invoice no longer exists.';
  end if;

  if v_invoice.status = 'void' then
    raise exception 'Invoice % was voided, so nothing can be collected against it.',
      v_invoice.invoice_no
      using detail = coalesce(v_invoice.void_reason, ''),
            hint   = 'Raise a fresh bill for the visit at the collect desk.';
  end if;
  if v_invoice.status = 'paid' then
    raise exception 'Invoice % is already paid in full.', v_invoice.invoice_no;
  end if;

  -- ---------------------------------------------------------------------------
  -- What is actually outstanding, read under the lock.
  --
  -- Reversed payments are excluded, the same way invoice_summary.balance
  -- computes it: money refunded at the counter is not money against this bill.
  -- ---------------------------------------------------------------------------
  select coalesce(sum(pm.amount), 0) into v_paid
  from public.payments pm
  where pm.hospital_id = v_hospital_id
    and pm.invoice_id = v_invoice.id
    and not pm.is_reversed;

  v_balance := round(v_invoice.grand_total - v_paid, 2);

  -- ---------------------------------------------------------------------------
  -- The money.
  -- ---------------------------------------------------------------------------
  v_amount := round(coalesce(p_amount, 0), 2);

  if v_amount <= 0 then
    raise exception 'Enter the amount collected. The balance on % is %.',
      v_invoice.invoice_no, to_char(v_balance, 'FM999999990.00');
  end if;
  if v_amount > v_balance then
    raise exception 'That is more than the % still owing on %. Enter the amount actually collected.',
      to_char(v_balance, 'FM999999990.00'), v_invoice.invoice_no;
  end if;
  if p_mode is null then
    raise exception 'Record how the payment was made: cash, UPI, card or other.';
  end if;
  if v_collected_by is null then
    raise exception 'A payment has to record who collected it.';
  end if;

  v_reference := nullif(btrim(coalesce(p_reference, '')), '');

  insert into public.payments (
    id, hospital_id, invoice_id, amount, mode, reference, collected_by
  )
  values (
    coalesce(p_payment_id, gen_random_uuid()),
    v_hospital_id, v_invoice.id, v_amount, p_mode, v_reference, v_collected_by
  );

  -- ---------------------------------------------------------------------------
  -- The status, recomputed from the payment rows rather than from the amount
  -- just passed in.
  --
  -- Arithmetic on the argument alone would write `partial` for a 300 rupee
  -- payment that settles a 300 rupee bill already carrying 100 -- and the
  -- status would then disagree with invoice_summary.balance, which reads the
  -- rows. One of them has to be the authority, and it is the rows.
  -- ---------------------------------------------------------------------------
  select coalesce(sum(pm.amount), 0) into v_paid
  from public.payments pm
  where pm.hospital_id = v_hospital_id
    and pm.invoice_id = v_invoice.id
    and not pm.is_reversed;

  v_status := case
    when v_paid >= v_invoice.grand_total then 'paid'
    when v_paid > 0                      then 'partial'
    else                                      'unpaid'
  end;

  update public.invoices i
     set status = v_status
   where i.id = v_invoice.id
     and i.hospital_id = v_hospital_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

comment on function public.add_payment(uuid, numeric, public.payment_mode, text, uuid, uuid, uuid) is
  'Records a payment against an invoice that already exists and recomputes the invoice status from the payment rows. The settle-the-balance half of collect_payment: it never allocates a number and never creates an invoice. Idempotent on a client-supplied p_payment_id.';

revoke execute on function public.add_payment(uuid, numeric, public.payment_mode, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.add_payment(uuid, numeric, public.payment_mode, text, uuid, uuid, uuid)
  to authenticated;

-- =============================================================================
-- 20260902090200_reverse_payment.sql
-- reverse_payment(): correcting ONE payment without destroying the bill.
--
-- WHAT WAS WRONG
--
-- payments.is_reversed and payments.reversal_reason have existed since
-- 20260819090000, with the payments_reversal_has_reason check to keep them
-- honest -- and the only thing that ever set them was void_invoice, as a side
-- effect of voiding the whole invoice.
--
-- So a cash payment recorded as UPI could only be fixed by voiding an
-- otherwise correct bill: a consumed invoice number, a void reason that does
-- not describe what actually happened, charge lines released back to pending,
-- and a second invoice with a second number for the same treatment. All of
-- that to change one word on one row.
--
-- WHAT REVERSING IS AND IS NOT
--
-- It records a correction. It does NOT move cash. The refund, or the
-- re-collection in the right mode, happens at the counter; this is the record
-- that it did, and the screen says so in as many words. That is the same
-- position void_invoice takes, and it is why the day-close report has always
-- excluded reversed payments: money that was handed back is not money in the
-- drawer.
--
-- GATED ON billing.void, not billing.collect. Undoing a collection is the same
-- class of act as voiding a bill, and a hospital that withholds one will want
-- to withhold the other. In the database both sit behind assert_billing().
-- =============================================================================

create or replace function public.reverse_payment(
  p_payment_id  uuid,
  p_reason      text,
  p_hospital_id uuid default null
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_payment     public.payments;
  v_invoice     public.invoices;
  v_reason      text;
  v_paid        numeric(12,2);
  v_status      public.invoice_status;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_billing();

  -- A typed reason, not a confirm dialog (CLAUDE.md 7). Four characters, the
  -- same minimum void_invoice asks for, because this is the same kind of
  -- record and an auditor will read the two side by side.
  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 4 then
    raise exception 'Say why this payment is being reversed.';
  end if;

  select pm.* into v_payment
  from public.payments pm
  where pm.id = p_payment_id
    and pm.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'That payment no longer exists.';
  end if;
  if v_payment.is_reversed then
    raise exception 'That payment was already reversed.'
      using detail = coalesce(v_payment.reversal_reason, '');
  end if;

  -- The invoice is locked as well as the payment, and in that order, because
  -- add_payment takes the invoice lock first and then inserts: taking them the
  -- other way round here is how two cashiers -- one collecting, one reversing
  -- -- would deadlock on the same bill.
  select i.* into v_invoice
  from public.invoices i
  where i.id = v_payment.invoice_id
    and i.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'The invoice behind that payment no longer exists.';
  end if;

  update public.payments pm
     set is_reversed     = true,
         reversal_reason = v_reason
   where pm.id = v_payment.id
     and pm.hospital_id = v_hospital_id;

  -- ---------------------------------------------------------------------------
  -- The invoice status, recomputed from the rows -- exactly as add_payment
  -- does it, and for the same reason. A reversal can take a bill from `paid`
  -- back to `partial` or all the way to `unpaid`, and the arithmetic that
  -- decides which is the sum of what is left, not the amount just removed.
  --
  -- A VOID invoice is left void. It is not a state the money can argue with:
  -- the number is consumed, the lines are already back on the visit, and
  -- recomputing it to `unpaid` would put a bill nobody owes back on the dues
  -- report.
  -- ---------------------------------------------------------------------------
  if v_invoice.status <> 'void' then
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
  end if;

  return v_invoice;
end;
$$;

comment on function public.reverse_payment(uuid, text, uuid) is
  'Marks one payment reversed with a typed reason and recomputes the invoice status from the remaining payment rows. Records a correction; it does not move cash -- the refund happens at the counter. A void invoice stays void.';

revoke execute on function public.reverse_payment(uuid, text, uuid) from public, anon;
grant execute on function public.reverse_payment(uuid, text, uuid) to authenticated;

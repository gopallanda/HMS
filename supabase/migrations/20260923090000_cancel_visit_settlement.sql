-- =============================================================================
-- 20260923090000_cancel_visit_settlement.sql
-- cancel_visit() learns what happens to money that was already taken.
--
-- WHAT WAS WRONG
--
-- cancel_visit refused outright whenever any live payment existed against the
-- visit, and told the user to "reverse the payment or void the invoice at the
-- billing counter first". That sentence describes something the front desk
-- cannot do:
--
--   * register_patient_visit collects the consultation fee in the same
--     transaction that creates the visit, so EVERY normally registered visit
--     has a paid invoice from the moment it exists.
--   * seed_system_roles gives `front_desk` queue.cancel, billing.read and
--     billing.collect -- and deliberately NOT billing.void.
--
-- So the one role holding queue.cancel could never complete a cancellation,
-- and the ordinary walk-out -- patient pays, waits, gives up, leaves -- left a
-- `waiting` row on the doctor's board that the desk was told to fix at a
-- counter it has no permission to use. The waiting count beside each doctor on
-- the register screen was then wrong for the rest of the day, which is exactly
-- the failure cancel_visit was written to prevent.
--
-- WHY A CHOICE AND NOT SIMPLY ALLOWING IT
--
-- "Cancel a paid visit" is two different acts and the difference is the money:
--
--   retain  The hospital keeps the fee. The patient forfeited it, or was told
--           to come back with the same slip. Nothing is refunded, the invoice
--           stays exactly as it is, and it goes on being a true record of money
--           that was taken and is still in the drawer. This needs no billing
--           permission BECAUSE NO MONEY MOVES -- it is the front desk's path,
--           and it is the common one.
--   refund  The money goes back over the counter. That is void_invoice's job,
--           reason and audit row, and the app gates it on billing.void
--           (cancelVisitAction) because this function cannot see app
--           permissions -- assert_billing() is the coarse net and it admits
--           front_desk by design (CLAUDE.md 5, 3.6).
--
-- Passing neither keeps the old behaviour: a visit with money against it is
-- refused, with a hint that now names the choice instead of naming a counter.
-- That is deliberate for every existing caller and for any client that has not
-- been updated -- the quiet default must never be the one that moves cash.
--
-- WHAT `retain` VOIDS, AND WHAT IT LEAVES
--
-- Per invoice, not per visit. An invoice with no live payment against it is
-- voided exactly as before: nothing was collected on it, so there is nothing to
-- keep. An invoice WITH a live payment is left untouched, whether it is paid or
-- partial.
--
-- A retained partial payment therefore leaves a balance on a cancelled visit,
-- and it will keep showing on /billing/dues. That is on purpose and it is not a
-- leak: somebody part-paid and left, the hospital is owed the rest, and the
-- screen whose whole job is "who owes us money" is the right place for that to
-- be visible. Writing it off is a decision with a reason -- void_invoice -- not
-- a side effect of clearing a queue. A `written_off` status would be a change
-- to the shape of a money table, which needs a conversation (CLAUDE.md 10).
--
-- DROPPED AND RECREATED rather than replaced: a defaulted argument added to the
-- end of an existing function is a new OVERLOAD, and every existing
-- cancel_visit(p_visit_id => ..., p_reason => ...) call would then be
-- ambiguous. Same reasoning as 20260902090300 and 20260829090300.
-- =============================================================================

drop function if exists public.cancel_visit(uuid, text, uuid);

create or replace function public.cancel_visit(
  p_visit_id    uuid,
  p_reason      text,
  p_hospital_id uuid default null,
  -- null | 'retain' | 'refund'. Only consulted when money has actually been
  -- collected; null is the refusal that used to be the only answer.
  p_money       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_visit       public.visits;
  v_reason      text;
  v_money       text;
  v_invoice     public.invoices;
  v_paid        numeric(12,2);
  v_invoice_paid numeric(12,2);
  v_retained    numeric(12,2) := 0;
  v_voided      int := 0;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_front_desk();

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'Say why this visit is being cancelled.';
  end if;

  v_money := nullif(btrim(lower(coalesce(p_money, ''))), '');
  if v_money is not null and v_money not in ('retain', 'refund') then
    raise exception 'A cancellation either retains the payment or refunds it.';
  end if;

  -- FOR UPDATE, so two clerks cancelling the same walk-out do it one after the
  -- other rather than both reading `waiting` and both voiding the invoice.
  select v.* into v_visit
  from public.visits v
  where v.id = p_visit_id and v.hospital_id = v_hospital_id
  for update;

  if not found then
    raise exception 'That visit no longer exists.';
  end if;
  if v_visit.status = 'cancelled' then
    raise exception 'Visit % is already cancelled.', v_visit.visit_no;
  end if;
  if v_visit.status = 'completed' then
    raise exception 'Visit % has already been completed, so it cannot be cancelled.',
      v_visit.visit_no
      using hint = 'If the bill is wrong, void the invoice instead.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The money, before anything is written.
  --
  -- Totalled across every live invoice on the visit first, so a visit carrying
  -- two bills is answered whole rather than half cancelled.
  -- ---------------------------------------------------------------------------
  select coalesce(sum(pm.amount), 0) into v_paid
  from public.payments pm
  join public.invoices i
    on i.hospital_id = pm.hospital_id and i.id = pm.invoice_id
  where pm.hospital_id = v_hospital_id
    and i.visit_id = v_visit.id
    and i.status <> 'void'
    and not pm.is_reversed;

  if v_paid > 0 and v_money is null then
    raise exception 'Cannot cancel visit %: % has already been collected against it.',
      v_visit.visit_no, to_char(v_paid, 'FM999999990.00')
      using hint = 'Say whether the hospital keeps that payment or refunds it, '
                   'or reverse it at the billing counter first.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Void what has to be voided, invoice by invoice.
  --
  -- Through void_invoice rather than an update here, so the number stays
  -- consumed, the charge lines go back to `pending` and the whole thing lands
  -- in audit_log the same way a counter void does. The reason is derived from
  -- the cancellation, so the two records read as one event.
  -- ---------------------------------------------------------------------------
  for v_invoice in
    select i.*
    from public.invoices i
    where i.hospital_id = v_hospital_id
      and i.visit_id = v_visit.id
      and i.status <> 'void'
    order by i.invoice_no
  loop
    select coalesce(sum(pm.amount), 0) into v_invoice_paid
    from public.payments pm
    where pm.hospital_id = v_hospital_id
      and pm.invoice_id = v_invoice.id
      and not pm.is_reversed;

    -- Keeping the money means leaving the bill that records it alone. An
    -- invoice nobody has paid anything against is voided either way: there is
    -- nothing on it to retain.
    if v_money = 'retain' and v_invoice_paid > 0 then
      v_retained := v_retained + v_invoice_paid;
      continue;
    end if;

    perform public.void_invoice(
      p_invoice_id  => v_invoice.id,
      p_reason      => 'Visit ' || v_visit.visit_no || ' cancelled: ' || v_reason,
      p_hospital_id => v_hospital_id
    );
    v_voided := v_voided + 1;
  end loop;

  update public.visits
     set status = 'cancelled'
   where id = v_visit.id
     and hospital_id = v_hospital_id
  returning * into v_visit;

  -- The reason, and now also what was decided about the money. A trigger sees
  -- the status move and the reversal; it cannot see that somebody chose.
  insert into public.audit_log (
    hospital_id, table_name, record_id, action, actor_id, before, after
  )
  values (
    v_hospital_id,
    'visit_cancellation',
    v_visit.id,
    'insert',
    auth.uid(),
    null,
    jsonb_build_object(
      'visit_id',          v_visit.id,
      'visit_no',          v_visit.visit_no,
      'token_no',          v_visit.token_no,
      'doctor_id',         v_visit.doctor_id,
      'reason',            v_reason,
      'money',             coalesce(v_money, 'none_collected'),
      'invoices_voided',   v_voided,
      'payments_retained', v_retained
    )
  );

  return jsonb_build_object(
    'visit_id',          v_visit.id,
    'visit_no',          v_visit.visit_no,
    'token_no',          v_visit.token_no,
    'status',            v_visit.status,
    'invoices_voided',   v_voided,
    'payments_retained', v_retained,
    'reason',            v_reason
  );
end;
$$;

comment on function public.cancel_visit(uuid, text, uuid, text) is
  'Cancels a waiting or in-consultation visit with a typed reason. Voids invoices with nothing collected on them; for money already taken, p_money decides -- retain leaves the paid invoice alone, refund voids it through void_invoice (gated on billing.void in the app), and null refuses as before. The token is retired, never reissued.';

revoke execute on function public.cancel_visit(uuid, text, uuid, text) from public, anon;
grant execute on function public.cancel_visit(uuid, text, uuid, text) to authenticated;

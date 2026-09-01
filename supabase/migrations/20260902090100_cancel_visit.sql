-- =============================================================================
-- 20260902090100_cancel_visit.sql
-- cancel_visit(): the front-desk act that public.visit_status has always had a
-- value for and nothing could reach.
--
-- WHAT WAS WRONG
--
-- `cancelled` exists on visit_status. collect_payment refuses a cancelled
-- visit, transfer_visit refuses one, set_visit_status deliberately will not
-- produce one ("Cancelling a visit is a front-desk action and needs a
-- reason"), the queue filters them out of its counts -- and nothing in the
-- product could set it. A patient who walks out leaves a token in the queue
-- for the rest of the day, and the waiting count the register desk prints
-- beside each doctor is wrong from that moment on.
--
-- THREE DECISIONS WORTH THE WORDS
--
-- 1. MONEY IS NOT REVERSED AS A SIDE EFFECT. If any non-reversed payment
--    exists against the visit, the cancellation is REFUSED and the user is
--    told to reverse the payment or void the invoice at the counter first.
--    void_invoice does reverse payments -- but it is a deliberate act with its
--    own reason and its own permission, and a queue button that quietly
--    refunds money is how a drawer stops agreeing with the screen. An UNPAID
--    invoice is a different matter: nothing has been collected, so it is
--    voided here, the number stays consumed and its charge lines go back to
--    pending.
--
-- 2. THE TOKEN IS RETIRED, NOT RELEASED. Same rule as transfer_visit: the row
--    keeps its token_no, and create_visit allocates max(token_no) + 1 over
--    every visit that doctor has today including the cancelled ones. Somebody
--    in the waiting room is holding a printed slip with that number on it.
--
-- 3. THE REASON GOES TO audit_log, NOT TO A NEW COLUMN. Changing the shape of
--    public.visits needs a conversation (CLAUDE.md 10) and this does not earn
--    one: there is exactly one fact to record and audit_log is where the rest
--    of this visit's history already is. The row is written the way
--    log_receipt_print writes its own (20260829090100) -- a synthetic
--    table_name, because a trigger can see the status change but not why.
--    The visits_audit trigger still fires and records the before/after; this
--    is the companion row that carries the sentence.
--
-- The minimum reason length is 5, matching transfer_visit and the deferral
-- check rather than void_invoice's 4. This is the same class of act as a
-- transfer -- somebody is being removed from a queue they were told to wait
-- in -- and "x" is not an answer anybody can read back in a month.
-- =============================================================================

create or replace function public.cancel_visit(
  p_visit_id    uuid,
  p_reason      text,
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
  v_reason      text;
  v_invoice     public.invoices;
  v_paid        numeric(12,2);
  v_voided      int := 0;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_front_desk();

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'Say why this visit is being cancelled.';
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
  -- Checked across every live invoice on the visit first, so a visit carrying
  -- two bills -- one paid, one not -- is refused whole rather than half
  -- cancelled with one number voided.
  -- ---------------------------------------------------------------------------
  select coalesce(sum(pm.amount), 0) into v_paid
  from public.payments pm
  join public.invoices i
    on i.hospital_id = pm.hospital_id and i.id = pm.invoice_id
  where pm.hospital_id = v_hospital_id
    and i.visit_id = v_visit.id
    and i.status <> 'void'
    and not pm.is_reversed;

  if v_paid > 0 then
    raise exception 'Cannot cancel visit %: % has already been collected against it.',
      v_visit.visit_no, to_char(v_paid, 'FM999999990.00')
      using hint = 'Reverse the payment or void the invoice at the billing counter first, then cancel.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Void what was billed and never paid.
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

  -- The reason. See decision 3 in the header: a trigger sees the status move,
  -- it cannot see why.
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
      'visit_id',        v_visit.id,
      'visit_no',        v_visit.visit_no,
      'token_no',        v_visit.token_no,
      'doctor_id',       v_visit.doctor_id,
      'reason',          v_reason,
      'invoices_voided', v_voided
    )
  );

  return jsonb_build_object(
    'visit_id',        v_visit.id,
    'visit_no',        v_visit.visit_no,
    'token_no',        v_visit.token_no,
    'status',          v_visit.status,
    'invoices_voided', v_voided,
    'reason',          v_reason
  );
end;
$$;

comment on function public.cancel_visit(uuid, text, uuid) is
  'Cancels a waiting or in-consultation visit with a typed reason. Voids its unpaid invoices through void_invoice so the numbers stay consumed and the charges return to pending; REFUSES outright when money has already been collected. The token is retired, never reissued.';

revoke execute on function public.cancel_visit(uuid, text, uuid) from public, anon;
grant execute on function public.cancel_visit(uuid, text, uuid) to authenticated;

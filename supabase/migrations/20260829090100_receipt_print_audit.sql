-- =============================================================================
-- 20260829090100_receipt_print_audit.sql
-- Every reprint of a receipt is recorded. Block 5.
--
-- WHY THIS EXISTS
--
-- Reprints are how receipts get duplicated at a counter. A patient asks for
-- "another copy", walks to the next window with it, and the hospital now has
-- two pieces of paper for one payment. Nothing here prevents that -- a
-- hospital genuinely does need to reprint when the roll jams -- but a reprint
-- that leaves no trace cannot be investigated, and this is a money document.
--
-- WHY IT IS NOT A TRIGGER
--
-- Every other audit row in this schema comes from fn_audit() on a table write
-- (CLAUDE.md 3.5), because a write that skips the app must still be recorded.
-- A print is not a write: nothing in the database changes, so there is nothing
-- for a trigger to fire on. This is the one event the application has to
-- report itself.
--
-- WHY table_name = 'receipt_print' AND action = 'insert'
--
-- public.audit_action has three values and adding a fourth means ALTER TYPE,
-- which cannot be used in the same transaction that adds it -- two migrations
-- for one word. 'insert' on a synthetic table_name says the same thing:
-- a print event was created, against this invoice, by this person, at this
-- time. The `after` payload carries the paper it went to.
-- =============================================================================

create or replace function public.log_receipt_print(
  p_invoice_id uuid,
  p_format     text default null
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
  v_hospital_id := public.rpc_hospital_id(null);

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

comment on function public.log_receipt_print(uuid, text) is
  'Records that a receipt was printed. Not a trigger: a print changes no row, so the application is the only thing that can report it.';

revoke execute on function public.log_receipt_print(uuid, text) from public, anon;
grant execute on function public.log_receipt_print(uuid, text) to authenticated;

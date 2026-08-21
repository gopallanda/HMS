-- =============================================================================
-- 20260818090300_audit_log_trigger.sql
-- One generic trigger function, attached to every auditable table.
--
-- CLAUDE.md 3.5: mutations write to audit_log via a Postgres trigger -- not
-- from application code, so a write that skips the app is still recorded.
-- =============================================================================

create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer            -- audit_log has no insert policy; only this writes
set search_path = ''
as $$
declare
  v_before      jsonb;
  v_after       jsonb;
  v_row         jsonb;
  v_action      public.audit_action;
  v_record_id   uuid;
  v_hospital_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_after  := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- a no-op update is noise, not history
    if v_before = v_after then
      return new;
    end if;
  else
    v_action := 'delete';
    v_before := to_jsonb(old);
  end if;

  v_row       := coalesce(v_after, v_before);
  v_record_id := (v_row ->> 'id')::uuid;

  -- hospitals is the tenant root: its own id is the hospital_id.
  v_hospital_id := coalesce(
    nullif(v_row ->> 'hospital_id', '')::uuid,
    v_record_id
  );

  insert into public.audit_log (
    hospital_id, table_name, record_id, action, actor_id, before, after
  )
  values (
    v_hospital_id,
    tg_table_name,
    v_record_id,
    v_action,
    auth.uid(),          -- null for service-role / seed / migration writes
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

comment on function public.fn_audit() is
  'Generic audit trigger. Requires the table to have a uuid id column and (except hospitals) a hospital_id column.';

-- -----------------------------------------------------------------------------
-- Attach to the tables that exist so far.
--
-- Not attached to:
--   audit_log     -- would recurse
--   number_series -- no uuid id column, and it has no business history worth
--                    keeping; the numbers it hands out are audited on the rows
--                    that carry them.
--
-- Phase 1 adds patients, visits, invoices, payments, charge_items here.
-- -----------------------------------------------------------------------------
create trigger hospitals_audit
  after insert or update or delete on public.hospitals
  for each row execute function public.fn_audit();

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function public.fn_audit();

create trigger departments_audit
  after insert or update or delete on public.departments
  for each row execute function public.fn_audit();

create trigger staff_audit
  after insert or update or delete on public.staff
  for each row execute function public.fn_audit();

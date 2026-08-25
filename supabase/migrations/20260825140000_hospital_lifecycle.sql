-- =============================================================================
-- 20260825140000_hospital_lifecycle.sql
-- Tenant lifecycle on hospitals: plan, status, trial_ends_at.
--
-- WHY REAL COLUMNS, not settings jsonb: whether a tenant may still write is a
-- question the database has to answer on its own. settings is documented as
-- "never schema-critical" (20260818090000) and cannot be indexed, constrained
-- or type-checked. Suspension has to hold against a caller that skips the app
-- entirely, so it has to be enforceable in Postgres.
--
-- WHAT SUSPENSION MEANS HERE: read-only, not locked out.
--   * INSERT and UPDATE on tenant tables are refused by a trigger.
--   * SELECT is untouched, on every table, for everyone.
--
-- The read half is the part that matters and is not negotiable. This is
-- hospital software: a tenant behind on a subscription still has patients
-- whose history, prescriptions and past invoices have to be reachable. Locking
-- staff out of records over a commercial dispute turns a billing problem into
-- a clinical one.
--
-- The write half is deliberately uniform rather than clever. An earlier draft
-- blocked inserts and allowed updates, on the theory that work already in
-- flight should be finishable -- but the in-flight act that actually matters
-- at 3pm is collecting a payment, and that is an insert. So the carve-out
-- bought almost nothing and cost a rule nobody could state in one sentence.
-- No writes is a sentence.
--
-- WHERE THE CHECK LIVES: a trigger, not an RLS policy.
--   * The money RPCs (collect_payment, register_patient, create_visit,
--     save_consultation) are SECURITY DEFINER and bypass RLS by design, so a
--     policy would not see the writes that matter most.
--   * A trigger is one choke point rather than a clause repeated across
--     fifteen policies, and it catches service-role writes too.
--   * Read policies are deliberately NOT touched: adding a hospitals lookup to
--     every select would tax the queue and billing screens, which are the hot
--     path, to enforce a rule that only concerns writes -- and reads are meant
--     to keep working anyway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enums
--
-- Two plans, not a price list. 'trial' is the only tier that expires and so the
-- only one the database has to reason about; every paying tier behaves
-- identically here. Further tiers are `alter type public.hospital_plan add
-- value` when pricing is decided -- cheap, and not a decision to invent now.
--
-- 'cancelled' is intentionally absent from hospital_status. A cancelled tenant
-- behaves exactly like a suspended one as far as writes go, and the difference
-- is a billing fact rather than a database one. Add the value the day it
-- changes behaviour.
-- -----------------------------------------------------------------------------
create type public.hospital_plan as enum (
  'trial',
  'standard'
);

create type public.hospital_status as enum (
  'active',
  'suspended'
);

-- -----------------------------------------------------------------------------
-- columns
-- -----------------------------------------------------------------------------
alter table public.hospitals
  add column plan              public.hospital_plan   not null default 'trial',
  add column status            public.hospital_status not null default 'active',
  add column trial_ends_at     timestamptz,
  add column suspended_at      timestamptz,
  add column suspension_reason text;

-- Hospitals that existed before lifecycle tracking are not on a trial: nobody
-- ever offered them one, and leaving them at the 'trial' default would start a
-- clock they never agreed to. Backfill before the default starts applying to
-- new rows.
update public.hospitals set plan = 'standard';

-- New tenants get a 14 day trial. Set as a column default rather than inside
-- provision_hospital() so the trial applies however a hospital is created --
-- self-serve signup, a support-side insert, or the platform console later.
-- Existing rows keep trial_ends_at null, which means "no expiry" (see below).
alter table public.hospitals
  alter column trial_ends_at set default (now() + interval '14 days');

comment on column public.hospitals.plan is
  'Commercial tier. Only trial expires; every other tier is open ended.';
comment on column public.hospitals.status is
  'active | suspended. A suspended tenant is read only: no inserts and no updates on tenant tables, every select unaffected.';
comment on column public.hospitals.trial_ends_at is
  'End of the trial period. Null means no expiry -- correct for any non-trial plan, and for tenants that predate lifecycle tracking.';
comment on column public.hospitals.suspended_at is
  'Stamped by trigger when status becomes suspended, cleared when it becomes active. Never set by the app.';
comment on column public.hospitals.suspension_reason is
  'Why the tenant was suspended. Quoted back to them in the app banner and in the write error, in the same spirit as invoices.void_reason (CLAUDE.md 7).';

-- -----------------------------------------------------------------------------
-- lifecycle state
--
-- One function answers the question for everybody: the write trigger, the app,
-- and the platform console later. It returns a code rather than a boolean
-- because "suspended" and "trial expired" need different messages and have
-- different fixes -- one is a support conversation, the other is a card.
--
-- SECURITY DEFINER: called from a trigger that fires under whatever role is
-- writing, including from inside SECURITY DEFINER RPCs. Reading hospitals
-- through the caller's RLS would make the answer depend on who is asking,
-- which is exactly wrong for a gate.
-- -----------------------------------------------------------------------------
create or replace function public.hospital_lifecycle_state(p_hospital_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when h.id is null                then 'missing'
    when h.status = 'suspended'      then 'suspended'
    when h.plan = 'trial'
     and h.trial_ends_at is not null
     and h.trial_ends_at <= now()    then 'trial_expired'
    else 'active'
  end
  from (select 1) probe
  left join public.hospitals h on h.id = p_hospital_id;
$$;

comment on function public.hospital_lifecycle_state(uuid) is
  'active | suspended | trial_expired | missing. Single source of truth for whether a tenant may still write.';

create or replace function public.hospital_is_active(p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.hospital_lifecycle_state(p_hospital_id) = 'active';
$$;

comment on function public.hospital_is_active(uuid) is
  'True only when the tenant is active and, on trial, not expired. Fails closed for a hospital_id that does not exist.';

-- -----------------------------------------------------------------------------
-- the gate
--
-- BEFORE INSERT OR UPDATE on every tenant table. It reads new.hospital_id, so
-- one function serves all of them.
--
-- Not attached to:
--   hospitals     -- a new hospital cannot be blocked by its own status, which
--                    does not exist yet at insert time; and the update that
--                    LIFTS a suspension has to be able to run.
--   number_series -- written only by next_number(), inside a transaction whose
--                    real write is already gated. Blocking here would only
--                    change which error the caller sees.
--   audit_log     -- history is recorded whatever the tenant's status.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_hospital_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_row   public.hospitals%rowtype;
begin
  v_state := public.hospital_lifecycle_state(new.hospital_id);

  if v_state = 'active' then
    return new;
  end if;

  select * into v_row from public.hospitals where id = new.hospital_id;

  if v_state = 'suspended' then
    raise exception 'This hospital is suspended, so nothing can be saved. %',
      coalesce(
        'Reason: ' || v_row.suspension_reason,
        'Contact support to have this lifted.'
      )
      using errcode = '42501';
  elsif v_state = 'trial_expired' then
    raise exception 'The trial for this hospital ended on %, so nothing can be saved. Choose a plan to carry on.',
      pg_catalog.to_char(v_row.trial_ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
      using errcode = '42501';
  else
    raise exception 'No such hospital: %', new.hospital_id
      using errcode = '23503';
  end if;
end;
$$;

comment on function public.enforce_hospital_active() is
  'Write gate on tenant tables. Refuses inserts and updates for a suspended or expired tenant; reads are unaffected.';

create trigger memberships_hospital_active
  before insert or update on public.memberships
  for each row execute function public.enforce_hospital_active();

create trigger departments_hospital_active
  before insert or update on public.departments
  for each row execute function public.enforce_hospital_active();

create trigger staff_hospital_active
  before insert or update on public.staff
  for each row execute function public.enforce_hospital_active();

create trigger patients_hospital_active
  before insert or update on public.patients
  for each row execute function public.enforce_hospital_active();

create trigger services_hospital_active
  before insert or update on public.services
  for each row execute function public.enforce_hospital_active();

create trigger visits_hospital_active
  before insert or update on public.visits
  for each row execute function public.enforce_hospital_active();

create trigger charge_items_hospital_active
  before insert or update on public.charge_items
  for each row execute function public.enforce_hospital_active();

create trigger invoices_hospital_active
  before insert or update on public.invoices
  for each row execute function public.enforce_hospital_active();

create trigger payments_hospital_active
  before insert or update on public.payments
  for each row execute function public.enforce_hospital_active();

create trigger consultations_hospital_active
  before insert or update on public.consultations
  for each row execute function public.enforce_hospital_active();

-- -----------------------------------------------------------------------------
-- suspended_at is derived, so the database keeps it, not the caller.
-- -----------------------------------------------------------------------------
create or replace function public.stamp_hospital_suspension()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'suspended' then
      new.suspended_at := now();
    else
      new.suspended_at      := null;
      new.suspension_reason := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger hospitals_stamp_suspension
  before update on public.hospitals
  for each row execute function public.stamp_hospital_suspension();

-- -----------------------------------------------------------------------------
-- Who may change these columns
--
-- hospitals_update_admin (20260818090100) lets an admin update their own
-- hospital row so branding can be edited. As written that includes status --
-- a suspended hospital's own admin could simply clear the suspension. RLS
-- cannot restrict which COLUMNS a policy covers, so this is a column
-- privilege instead.
--
-- After this, `update hospitals set status = 'active'` from an app client
-- fails on privileges whatever the policy says. Lifecycle belongs to the
-- platform: service role today, the /platform console later.
-- -----------------------------------------------------------------------------
revoke update on public.hospitals from authenticated, anon;

grant update (name, logo_url, address, phone, gstin, settings)
  on public.hospitals to authenticated;

grant execute on function public.hospital_lifecycle_state(uuid) to authenticated;
grant execute on function public.hospital_is_active(uuid)       to authenticated;

-- The trigger functions are reached through triggers, never called directly.
revoke execute on function public.enforce_hospital_active()   from public, anon, authenticated;
revoke execute on function public.stamp_hospital_suspension() from public, anon, authenticated;

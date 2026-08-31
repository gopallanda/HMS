-- =============================================================================
-- 20260829090000_registration_transaction.sql
-- Registration becomes one transaction: patient -> visit -> token -> invoice
-- -> payment. Block 4 of the phase 1 remediation.
--
-- WHAT WAS WRONG
--
-- A visit could exist with no doctor, no payment and no token, because the
-- screen made three separate calls and a clerk could stop after the first. A
-- visit in that state is invisible: it is in nobody's queue, on nobody's
-- report, and the money for it was never asked for. The fix is not a required
-- field on a form -- it is that the three writes become one, and the database
-- refuses the incomplete shape.
--
-- FOUR CHANGES, in dependency order:
--
--   1. Tokens become per DOCTOR per day. "Number 7" has to mean "seventh
--      patient waiting for Dr Rao", not "seventh person through the door",
--      or the number called out in the corridor belongs to somebody else's
--      queue.
--   2. Reception may take money. It always could in practice -- the
--      consultation fee is collected at the desk -- but assert_billing() and
--      the invoice policies said otherwise, which is why registration could
--      not raise its own invoice. lib/roles.ts named this exact change.
--   3. visit_payment_deferrals: who let a patient be seen before paying, and
--      why. A new table rather than a column on visits, so the protected money
--      and patient tables keep their shape (CLAUDE.md 10) and so PAYMENT DUE
--      stays DERIVED from the invoice rather than a second copy of its status
--      that somebody has to remember to update.
--   4. register_patient_visit(): the whole thing, in one transaction.
--
-- Error codes raised here, for lib/supabase/errors.ts:
--   42501  cross-tenant access, or a role that may not do this
-- Everything else is a plain raise, written to be read by the person at the
-- desk. 90001 (duplicate phone) is deliberately NOT raised by this path --
-- see the header of section 4.
-- =============================================================================

-- =============================================================================
-- 1. Tokens are per doctor, per day
-- =============================================================================

-- The old index made the whole hospital one queue. Dropped rather than kept
-- alongside: two patients booked to different doctors must be allowed to share
-- a number, which is precisely what it forbade.
drop index if exists public.visits_hospital_id_day_token_key;

-- coalesce, not a bare doctor_id: NULLs are distinct in a unique index, so
-- without it every unassigned visit could be given the same token as every
-- other one. After this migration registration always supplies a doctor, but
-- create_visit still accepts null for an emergency arriving before anybody is
-- assigned, and that case has to be counted too.
create unique index visits_hospital_id_day_doctor_token_key
  on public.visits (
    hospital_id,
    public.ist_date(visited_at),
    coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    token_no
  );

comment on index public.visits_hospital_id_day_doctor_token_key is
  'One token per doctor per day. create_visit allocates under an advisory lock on the same three values; this is what makes it a guarantee rather than a convention.';

-- =============================================================================
-- 2. Reception takes the consultation fee
--
-- The comment this replaces (20260819090000) said: "In hospitals where
-- reception also takes money, add 'front_desk' here and to BILLING_ROLES in
-- lib/roles.ts. Those two places are the whole change." Registration now
-- collects at the desk by design, so this is that change.
--
-- It widens what reception can READ as well as write, and deliberately: a
-- clerk who has just taken 300 rupees has to be able to reprint the receipt
-- for it. The app's own boundary is finer -- billing.collect and billing.read
-- are separate permissions and a hospital can withhold either (CLAUDE.md 3.6).
-- =============================================================================
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

  if not public.has_role('super_admin', 'admin', 'cashier', 'front_desk') then
    raise exception 'Only billing staff can raise invoices and take payments.'
      using errcode = '42501';
  end if;
end;
$$;

drop policy if exists invoices_select_billing on public.invoices;
create policy invoices_select_billing on public.invoices
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'cashier', 'front_desk')
  );

drop policy if exists payments_select_billing on public.payments;
create policy payments_select_billing on public.payments
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'cashier', 'front_desk')
  );

-- =============================================================================
-- 3. visit_payment_deferrals
--
-- "Patient cannot pay now" is rare, and the whole point of the feature is that
-- it is visible and attributable rather than a silent skip. One row per
-- deferral: the visit, the invoice left unpaid, the typed reason, and who
-- approved it.
--
-- No settled_at column. Whether the money has since been collected is a fact
-- about the INVOICE, and a second copy of it here would be one more thing to
-- keep in step -- exactly the bug this table is meant to avoid. PAYMENT DUE is
-- derived, in section 3b.
-- =============================================================================
create table public.visit_payment_deferrals (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references public.hospitals(id),
  visit_id      uuid not null,
  invoice_id    uuid not null,
  reason        text not null check (length(btrim(reason)) >= 5),
  approved_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),

  -- One deferral per visit. A second one would mean the first was settled, and
  -- settling is a payment, not another deferral.
  constraint visit_payment_deferrals_visit_key unique (hospital_id, visit_id),
  constraint visit_payment_deferrals_visit_same_hospital_fkey
    foreign key (hospital_id, visit_id)
    references public.visits (hospital_id, id),
  constraint visit_payment_deferrals_invoice_same_hospital_fkey
    foreign key (hospital_id, invoice_id)
    references public.invoices (hospital_id, id)
);

create index visit_payment_deferrals_hospital_id_created_at_idx
  on public.visit_payment_deferrals (hospital_id, created_at desc);

comment on table public.visit_payment_deferrals is
  'Who was let through without paying, why, and on whose say-so. Written only by register_patient_visit.';

alter table public.visit_payment_deferrals enable row level security;

-- Readable by everybody in the hospital: the reason is what the cashier needs
-- when the patient comes back to the counter, and the doctor needs when they
-- are asked why the badge is on the queue row. There is no insert, update or
-- delete policy at all -- the SECURITY DEFINER function below is the only
-- writer, the same arrangement charge_items and invoices use (CLAUDE.md 3.2).
create policy visit_payment_deferrals_select_tenant on public.visit_payment_deferrals
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create trigger visit_payment_deferrals_audit
  after insert or update or delete on public.visit_payment_deferrals
  for each row execute function public.fn_audit();

-- -----------------------------------------------------------------------------
-- 3b. PAYMENT DUE, derived
--
-- SECURITY DEFINER, and returning a boolean and nothing else, on purpose.
-- Whether this visit still owes money is a fact the whole hospital works from:
-- it goes on the queue row and on the visit header, and a nurse calling the
-- next patient needs it as much as the cashier does. The AMOUNT, the invoice
-- and the payment history stay behind the billing policies, which this does
-- not open.
-- -----------------------------------------------------------------------------
create or replace function public.visit_payment_due(p_hospital_id uuid, p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices i
    where i.hospital_id = p_hospital_id
      and i.visit_id    = p_visit_id
      and i.status in ('unpaid', 'partial')
  );
$$;

comment on function public.visit_payment_due(uuid, uuid) is
  'Whether this visit has an invoice still owing. One bit, readable by any member of the hospital; the amount stays behind the billing policies.';

revoke execute on function public.visit_payment_due(uuid, uuid) from public, anon;
grant execute on function public.visit_payment_due(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The queue screen carries the badge, so the view carries the flag.
-- -----------------------------------------------------------------------------
drop view if exists public.visit_queue;

create view public.visit_queue
with (security_invoker = on) as
select
  v.id,
  v.hospital_id,
  v.visit_no,
  v.token_no,
  v.visit_type,
  v.status,
  v.visited_at,
  public.ist_date(v.visited_at) as visit_date,
  v.patient_id,
  p.mrn                          as patient_mrn,
  p.full_name                    as patient_name,
  p.dob                          as patient_dob,
  p.gender                       as patient_gender,
  p.phone                        as patient_phone,
  v.doctor_id,
  s.full_name                    as doctor_name,
  v.department_id,
  d.name                         as department_name,
  coalesce(c.charge_total, 0)    as charge_total,
  public.visit_payment_due(v.hospital_id, v.id) as payment_due,
  df.reason                      as defer_reason,
  v.created_by
from public.visits v
join public.patients p
  on p.hospital_id = v.hospital_id and p.id = v.patient_id
left join public.staff s
  on s.hospital_id = v.hospital_id and s.id = v.doctor_id
left join public.departments d
  on d.hospital_id = v.hospital_id and d.id = v.department_id
left join public.visit_payment_deferrals df
  on df.hospital_id = v.hospital_id and df.visit_id = v.id
left join lateral (
  select sum(ci.amount) as charge_total
  from public.charge_items ci
  where ci.hospital_id = v.hospital_id
    and ci.visit_id = v.id
    and ci.status <> 'cancelled'
) c on true;

comment on view public.visit_queue is
  'Read model for the queue screen: visit, patient, doctor, department, charges raised so far, and whether the visit still owes money. security_invoker, so RLS on the underlying tables applies.';

grant select on public.visit_queue to authenticated;

-- =============================================================================
-- 4. create_visit: the token is now per doctor
--
-- Only the allocation block changes. Everything else in this function is
-- 20260818120100 unchanged, and it is repeated in full because
-- CREATE OR REPLACE FUNCTION takes a whole body.
-- =============================================================================
create or replace function public.create_visit(payload jsonb)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id   uuid;
  v_id            uuid;
  v_patient_id    uuid;
  v_doctor_id     uuid;
  v_department_id uuid;
  v_visit_type    public.visit_type;
  v_visited_at    timestamptz;
  v_day           date;
  v_visit_no      text;
  v_token         int;
  v_visit         public.visits;
  v_patient       public.patients;
  v_doctor        public.staff;
  v_seed          boolean;
  v_service       public.services;
  v_service_id    uuid;
  v_fee           numeric(12,2);
begin
  v_hospital_id := public.rpc_hospital_id(nullif(payload ->> 'hospital_id', '')::uuid);
  perform public.assert_front_desk();

  v_id            := nullif(payload ->> 'id', '')::uuid;
  v_patient_id    := nullif(payload ->> 'patient_id', '')::uuid;
  v_doctor_id     := nullif(payload ->> 'doctor_id', '')::uuid;
  v_department_id := nullif(payload ->> 'department_id', '')::uuid;
  v_seed          := coalesce((payload ->> 'seed_consultation')::boolean, true);
  v_service_id    := nullif(payload ->> 'consultation_service_id', '')::uuid;

  if v_id is not null then
    select v.* into v_visit
    from public.visits v
    where v.id = v_id and v.hospital_id = v_hospital_id;

    if found then
      return v_visit;
    end if;
  end if;

  begin
    v_visit_type := coalesce((payload ->> 'visit_type')::public.visit_type, 'opd');
  exception when others then
    raise exception 'Visit type must be opd, ipd or emergency.';
  end;

  if public.app_hospital_id() is null then
    v_visited_at := coalesce((payload ->> 'visited_at')::timestamptz, now());
  else
    v_visited_at := now();
  end if;

  if v_patient_id is null then
    raise exception 'A visit needs a patient. Search for one first.';
  end if;

  select p.* into v_patient
  from public.patients p
  where p.id = v_patient_id and p.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That patient record no longer exists.';
  end if;
  if v_patient.deleted_at is not null then
    raise exception 'That patient record has been removed.';
  end if;

  if v_doctor_id is not null then
    select s.* into v_doctor
    from public.staff s
    where s.id = v_doctor_id and s.hospital_id = v_hospital_id;

    if not found then
      raise exception 'That doctor is not on the staff list.';
    end if;
    if v_doctor.role <> 'doctor' then
      raise exception '% is not a doctor.', v_doctor.full_name;
    end if;
    if not v_doctor.is_active then
      raise exception '% is no longer active.', v_doctor.full_name;
    end if;

    v_department_id := coalesce(v_department_id, v_doctor.department_id);
  end if;

  -- ---------------------------------------------------------------------------
  -- visit_no from number_series (per hospital, per financial year), and the
  -- queue token, which is per DOCTOR per DAY and therefore not from
  -- number_series at all.
  --
  -- The advisory lock is held to the end of this transaction and serialises
  -- token allocation for this hospital, day and doctor only -- two doctors, two
  -- hospitals, or the same doctor tomorrow never wait on each other. max()+1
  -- under that lock is exact, and a rolled-back visit gives its token back,
  -- which is what the queue on the wall expects.
  -- visits_hospital_id_day_doctor_token_key enforces it.
  --
  -- Lock ordering note: this is taken BEFORE next_number's row lock in
  -- register_patient_visit, and every caller does it in that order. Reversing
  -- it anywhere reintroduces a deadlock between two clerks registering at once.
  -- ---------------------------------------------------------------------------
  v_visit_no := public.next_number(v_hospital_id, 'visit');
  v_day      := public.ist_date(v_visited_at);

  perform pg_advisory_xact_lock(
    hashtext(
      v_hospital_id::text || ':' || v_day::text || ':' ||
      coalesce(v_doctor_id::text, '-')
    )::bigint
  );

  select coalesce(max(v.token_no), 0) + 1
    into v_token
  from public.visits v
  where v.hospital_id = v_hospital_id
    and public.ist_date(v.visited_at) = v_day
    and v.doctor_id is not distinct from v_doctor_id;

  insert into public.visits (
    id, hospital_id, patient_id, visit_no, token_no, visit_type,
    doctor_id, department_id, status, visited_at, created_by
  )
  values (
    coalesce(v_id, gen_random_uuid()),
    v_hospital_id,
    v_patient_id,
    v_visit_no,
    v_token,
    v_visit_type,
    v_doctor_id,
    v_department_id,
    'waiting',
    v_visited_at,
    auth.uid()
  )
  returning * into v_visit;

  if v_seed and v_doctor_id is not null then
    v_fee := coalesce(v_doctor.consultation_fee, 0);

    if v_fee > 0 then
      if v_service_id is not null then
        select s.* into v_service
        from public.services s
        where s.id = v_service_id
          and s.hospital_id = v_hospital_id
          and s.is_active;

        if not found then
          raise exception 'That consultation service is not available.';
        end if;
      else
        select s.* into v_service
        from public.services s
        where s.hospital_id = v_hospital_id
          and s.category = 'consultation'
          and s.is_active
        order by s.created_at, s.name
        limit 1;
      end if;

      insert into public.charge_items (
        hospital_id, visit_id, service_id, description,
        qty, unit_price, amount, tax_rate,
        source_module, status, created_by
      )
      values (
        v_hospital_id,
        v_visit.id,
        v_service.id,
        'Consultation - ' || v_doctor.full_name,
        1,
        v_fee,
        v_fee,
        coalesce(v_service.tax_rate, 0),
        'front_desk',
        'pending',
        auth.uid()
      );
    end if;
  end if;

  return v_visit;
end;
$$;

comment on function public.create_visit(jsonb) is
  'Creates a visit with a visit_no from next_number and a per-doctor, per-day queue token, and seeds the consultation charge from the doctor fee. Idempotent on a client-supplied id.';

-- -----------------------------------------------------------------------------
-- What the success panel needs, in the shape it needs it.
--
-- Its own function because register_patient_visit returns it from two places
-- -- the idempotent replay and the real path -- and the two must not drift.
-- -----------------------------------------------------------------------------
create or replace function public.registration_result(
  p_patient public.patients,
  p_visit   public.visits,
  p_invoice public.invoices
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'patient_id',   p_patient.id,
    'mrn',          p_patient.mrn,
    'patient_name', p_patient.full_name,
    'visit_id',     p_visit.id,
    'visit_no',     p_visit.visit_no,
    'token_no',     p_visit.token_no,
    'doctor_id',    p_visit.doctor_id,
    'doctor_name',  (select s.full_name from public.staff s
                      where s.hospital_id = p_visit.hospital_id
                        and s.id = p_visit.doctor_id),
    'department_name', (select d.name from public.departments d
                         where d.hospital_id = p_visit.hospital_id
                           and d.id = p_visit.department_id),
    'invoice_id',   p_invoice.id,
    'invoice_no',   p_invoice.invoice_no,
    'grand_total',  p_invoice.grand_total,
    'payment_due',  p_invoice.status in ('unpaid', 'partial')
  );
$$;

revoke execute on function public.registration_result(public.patients, public.visits, public.invoices)
  from public, anon, authenticated;

-- =============================================================================
-- 5. register_patient_visit -- the whole desk, one transaction
--
-- Block 4.3. Everything or nothing: a failure anywhere below leaves no
-- patient, no visit, no token, no invoice and no payment. That is the entire
-- point, and it is why this is a function rather than five calls from a Server
-- Action.
--
-- ON THE DUPLICATE PHONE (defect 4)
--
-- This path NEVER raises 90001. A phone number identifies a household, not a
-- person: an Indian family shares one mobile, and that is the norm rather than
-- the anomaly. register_patient's force_create flag is set unconditionally
-- here. What prevents duplicate MRNs is the matches panel on the screen, which
-- offers "use this patient" -- information, not a block.
--
-- WHAT IS VALIDATED HERE AND NOT ONLY ON THE FORM
--
--   * a doctor is required
--   * a payment mode is required unless the deferral path was used
--   * a deferral requires a reason
--
-- The form checks all three first, so the clerk is told before the round trip.
-- They are repeated here because an RPC answers a POST without the form, and
-- the database is the last honest boundary.
--
-- Arguments follow the prompt's signature, plus three optional ids for
-- idempotency (CLAUDE.md 7): a form resubmitted after a dropped connection
-- returns what it already wrote instead of registering the patient twice.
-- =============================================================================
create or replace function public.register_patient_visit(
  p_hospital_id   uuid    default null,
  p_patient_id    uuid    default null,
  p_patient       jsonb   default null,
  p_doctor_id     uuid    default null,
  p_department_id uuid    default null,
  p_fee           numeric default null,
  p_payment_mode  text    default null,
  p_deferred      boolean default false,
  p_defer_reason  text    default null,
  p_actor_id      uuid    default null,
  p_visit_id      uuid    default null,
  p_invoice_id    uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_actor       uuid := coalesce(auth.uid(), p_actor_id);
  v_deferred    boolean := coalesce(p_deferred, false);
  v_reason      text;
  v_mode        public.payment_mode;
  v_fee         numeric(12,2);
  v_patient     public.patients;
  v_doctor      public.staff;
  v_service     public.services;
  v_visit       public.visits;
  v_invoice     public.invoices;
  v_department  text;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_front_desk();

  -- ---------------------------------------------------------------------------
  -- Idempotency first, before any validation, so a retry returns what was
  -- written even if a rule has changed since.
  -- ---------------------------------------------------------------------------
  if p_visit_id is not null then
    select v.* into v_visit
    from public.visits v
    where v.id = p_visit_id and v.hospital_id = v_hospital_id;

    if found then
      select p.* into v_patient
      from public.patients p
      where p.id = v_visit.patient_id and p.hospital_id = v_hospital_id;

      select i.* into v_invoice
      from public.invoices i
      where i.hospital_id = v_hospital_id and i.visit_id = v_visit.id
      order by i.invoice_date, i.invoice_no
      limit 1;

      return public.registration_result(v_patient, v_visit, v_invoice);
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- The three rules the form cannot be trusted to have applied.
  -- ---------------------------------------------------------------------------
  if p_doctor_id is null then
    raise exception 'Choose a doctor. A visit with no doctor is in nobody''s queue.';
  end if;

  if v_deferred then
    v_reason := nullif(btrim(coalesce(p_defer_reason, '')), '');
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'Say why the patient is being seen before paying.';
    end if;
  else
    if nullif(btrim(coalesce(p_payment_mode, '')), '') is null then
      raise exception 'Record how the payment was made: cash, UPI or card.';
    end if;

    begin
      v_mode := p_payment_mode::public.payment_mode;
    exception when others then
      raise exception 'Payment mode must be cash, UPI, card or other.';
    end;
  end if;

  -- ---------------------------------------------------------------------------
  -- The doctor, and the fee. The fee defaults to the doctor's own -- the staff
  -- row is the authority on it (CLAUDE.md 4) -- and the desk may override it
  -- only downward-or-upward within the form's own permission check; the
  -- database only insists that it is a real, non-negative amount.
  -- ---------------------------------------------------------------------------
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

  v_fee := round(coalesce(p_fee, v_doctor.consultation_fee, 0), 2);
  if v_fee < 0 then
    raise exception 'A consultation fee cannot be negative.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The patient: the one that was chosen, or a new one.
  --
  -- register_patient allocates the MRN from number_series under its own
  -- SELECT ... FOR UPDATE, so two clerks registering at the same instant get
  -- different numbers or one of them waits. force_create is always true: see
  -- the header.
  -- ---------------------------------------------------------------------------
  if p_patient_id is not null then
    select p.* into v_patient
    from public.patients p
    where p.id = p_patient_id and p.hospital_id = v_hospital_id;

    if not found then
      raise exception 'That patient record no longer exists.';
    end if;
    if v_patient.deleted_at is not null then
      raise exception 'That patient record has been removed.';
    end if;
  else
    if p_patient is null or jsonb_typeof(p_patient) <> 'object' then
      raise exception 'Enter the patient''s details, or choose an existing record.';
    end if;

    v_patient := public.register_patient(
      p_patient
        || jsonb_build_object('hospital_id', v_hospital_id::text)
        || jsonb_build_object('force_create', true)
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- The visit and the token.
  --
  -- seed_consultation is false: the fee is billed below through
  -- collect_payment, which is the only path that may create an invoice
  -- (CLAUDE.md 3.2). Seeding a charge here as well would put the fee on the
  -- bill twice.
  -- ---------------------------------------------------------------------------
  v_visit := public.create_visit(jsonb_build_object(
    'id',                p_visit_id,
    'hospital_id',       v_hospital_id::text,
    'patient_id',        v_patient.id::text,
    'doctor_id',         p_doctor_id::text,
    'department_id',     p_department_id,
    'visit_type',        'opd',
    'seed_consultation', false
  ));

  -- ---------------------------------------------------------------------------
  -- The invoice.
  --
  -- One line, from the charge master, so the GST treatment is the SERVICE's
  -- and not a rate assumed across the bill (CLAUDE.md 8). A hospital
  -- consultation is normally exempt; the tax_rate on the row is what decides,
  -- and nothing here overrides it.
  -- ---------------------------------------------------------------------------
  select s.* into v_service
  from public.services s
  where s.hospital_id = v_hospital_id
    and s.category = 'consultation'
    and s.is_active
  order by s.created_at, s.name
  limit 1;

  if not found then
    raise exception 'This hospital has no consultation service on its price list, so the fee cannot be billed. Add one under Administration -> Price list.';
  end if;

  v_invoice := public.collect_payment(
    p_visit_id     => v_visit.id,
    p_items        => jsonb_build_array(jsonb_build_object(
                        'service_id',  v_service.id::text,
                        'qty',         1,
                        'unit_price',  v_fee,
                        'description', 'Consultation - ' || v_doctor.full_name
                      )),
    p_mode         => case when v_deferred then null else v_mode end,
    -- Deferred means nothing was collected. Otherwise the fee is taken in
    -- full: a part payment at registration is a billing-counter workflow, and
    -- putting it on this screen would make the fast path slower for the ninety
    -- per cent who simply pay.
    p_amount       => case when v_deferred then 0 else v_fee end,
    p_reference    => null,
    p_invoice_id   => p_invoice_id,
    p_hospital_id  => v_hospital_id,
    p_collected_by => case when auth.uid() is null then v_actor else null end
  );

  if v_deferred then
    insert into public.visit_payment_deferrals (
      hospital_id, visit_id, invoice_id, reason, approved_by
    )
    values (v_hospital_id, v_visit.id, v_invoice.id, v_reason, v_actor);
  end if;

  return public.registration_result(v_patient, v_visit, v_invoice);
end;
$$;

comment on function public.register_patient_visit(uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid) is
  'Registration in one transaction: patient (MRN), visit (visit_no + per-doctor token), invoice (number), payment or deferral. The only path the register screen uses.';

revoke execute on function public.register_patient_visit(uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.register_patient_visit(uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid)
  to authenticated;

-- =============================================================================
-- 20260818120000_patients_visits_services.sql
-- Phase 1 core: patients, services (the charge master), visits, charge_items.
--
-- Rules enforced here (CLAUDE.md 3.1):
--   * every table carries hospital_id not null references hospitals(id)
--   * every unique constraint on a business key is scoped to hospital_id
--   * every composite index leads with hospital_id
--   * every table also carries unique (hospital_id, id), so its children can
--     hold a composite foreign key that pins the tenant -- a visit cannot
--     point at another hospital's patient even if the app asks it to
--
-- charge_items is created here, ahead of the billing slice, because
-- create_visit seeds a consultation charge from the doctor's fee (CLAUDE.md 4)
-- and has nowhere to put it otherwise. Nothing writes it except an RPC.
-- =============================================================================

-- Name search on the front desk is "type any part of it": pg_trgm makes that
-- an index scan instead of a table scan. btree_gin lets the same GIN index
-- lead with hospital_id, so the tenant is part of the index rather than a
-- filter applied after it.
--
-- Supabase keeps extensions in the `extensions` schema. IF NOT EXISTS skips
-- the WITH SCHEMA clause entirely when an extension is already installed
-- somewhere else, so this is safe on a project that already has them. The
-- search_path line below is what lets `gin_trgm_ops` resolve either way --
-- objects created by this file still land in public, the first entry.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gin with schema extensions;

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- enums (lowercase snake_case values, per CLAUDE.md 4)
-- -----------------------------------------------------------------------------
create type public.gender as enum (
  'male',
  'female',
  'other'
);

create type public.visit_type as enum (
  'opd',
  'ipd',
  'emergency'
);

create type public.visit_status as enum (
  'waiting',
  'in_consultation',
  'completed',
  'cancelled'
);

create type public.service_category as enum (
  'consultation',
  'lab',
  'procedure',
  'bed',
  'pharmacy',
  'other'
);

create type public.charge_status as enum (
  'pending',
  'invoiced',
  'cancelled'
);

-- Which desk raised the charge. Day-close groups collections by it later.
create type public.charge_source as enum (
  'front_desk',
  'doctor',
  'lab',
  'pharmacy',
  'ipd',
  'billing'
);

-- -----------------------------------------------------------------------------
-- ist_date -- the calendar day a timestamp falls on in India.
--
-- Queue tokens reset daily, and "daily" means the hospital's day, not UTC's.
-- A unique index needs an IMMUTABLE expression, and `at time zone 'Asia/Kolkata'`
-- is only STABLE (the timezone database can be updated underneath it), so the
-- offset is applied as fixed arithmetic instead. India has been UTC+05:30 with
-- no DST since 1945; if that ever changes, this function and every index built
-- on it have to be rebuilt deliberately.
-- -----------------------------------------------------------------------------
create or replace function public.ist_date(p_at timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select ((p_at at time zone 'UTC') + interval '330 minutes')::date;
$$;

comment on function public.ist_date(timestamptz) is
  'Calendar date of a timestamp in IST (fixed +05:30). IMMUTABLE so it can be indexed -- see visits_hospital_id_day_token_key.';

grant execute on function public.ist_date(timestamptz) to authenticated;

-- =============================================================================
-- patients
--
-- Soft delete only (CLAUDE.md 3.3): deleted_at, never a delete. The mrn unique
-- constraint is deliberately NOT partial -- a soft-deleted patient keeps their
-- number, because it is printed on a file that still exists in a cupboard.
--
-- dob is a date and age is computed (CLAUDE.md 3.3). It is NOT NULL: null
-- would mean "no age at all", which is worse on a paediatric chart than an
-- approximate one. When a patient does not know their birthday the register
-- form takes an age in years and stores the derived date -- the column never
-- holds an age integer. See lib/schemas/patient.ts.
-- =============================================================================
create table public.patients (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  mrn          text not null,
  full_name    text not null,
  dob          date not null,
  gender       public.gender not null,
  phone        text,
  address      text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  deleted_at   timestamptz,
  constraint patients_hospital_id_mrn_key unique (hospital_id, mrn),
  constraint patients_hospital_id_id_key unique (hospital_id, id)
);

-- Required by CLAUDE.md 4. Serves exact-phone lookups and prefix scans.
create index patients_hospital_id_phone_idx
  on public.patients (hospital_id, phone);

-- The lookup the front desk actually performs: someone reads a number off a
-- phone screen -- digits only, no +91, no spaces. Indexing the normalised form
-- means a stored '+91 98450 11223' is still found by typing '9845011223', and
-- trigrams mean the last four digits find it too, which is how people who have
-- forgotten their own number describe it.
create index patients_hospital_id_phone_digits_trgm_idx
  on public.patients using gin (
    hospital_id,
    regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') gin_trgm_ops
  )
  where deleted_at is null;

-- Substring search on the name, because staff type the surname.
create index patients_hospital_id_full_name_trgm_idx
  on public.patients using gin (hospital_id, full_name gin_trgm_ops)
  where deleted_at is null;

-- And on the number printed on the card the patient hands over. The unique
-- constraint above cannot serve a substring search, and staff type the tail of
-- an MRN far more often than the whole of it.
create index patients_hospital_id_mrn_trgm_idx
  on public.patients using gin (hospital_id, mrn gin_trgm_ops)
  where deleted_at is null;

-- Every one of the three searches above is a trigram match, so search_patients
-- requires at least 3 characters: a shorter pattern contains no whole trigram
-- and would fall back to a sequential scan on every keystroke.

create index patients_hospital_id_created_at_idx
  on public.patients (hospital_id, created_at desc)
  where deleted_at is null;

comment on table public.patients is
  'One row per person, for life. The doctor and the episode live on visits, not here.';
comment on column public.patients.mrn is
  'Medical record number, allocated by next_number(). Never reused, kept after soft delete.';
comment on column public.patients.deleted_at is
  'Soft delete (CLAUDE.md 3.3). Nothing in this app hard-deletes a patient.';

-- =============================================================================
-- services -- the charge master.
--
-- Lab, pharmacy and IPD bed charges all reuse this table later (CLAUDE.md 4),
-- which is why category exists now, and why tax_rate lives per service:
-- hospital services are largely GST-exempt while pharmacy sales are taxable
-- (CLAUDE.md 8). There is no invoice-wide tax rate anywhere in this schema.
-- =============================================================================
create table public.services (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  name         text not null,
  category     public.service_category not null,
  price        numeric(12,2) not null default 0 check (price >= 0),
  tax_rate     numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint services_hospital_id_id_key unique (hospital_id, id)
);

create unique index services_hospital_id_lower_name_key
  on public.services (hospital_id, lower(name));

create index services_hospital_id_category_is_active_idx
  on public.services (hospital_id, category, is_active);

comment on column public.services.price is
  'List price. For a consultation the doctor consultation_fee wins -- the doctor is the authority on their own fee.';
comment on column public.services.tax_rate is
  'Per-service GST percent. Services are usually 0; pharmacy items are not (CLAUDE.md 8).';

-- =============================================================================
-- visits
--
-- The doctor lives here, not on the patient (CLAUDE.md 4): the same person
-- sees orthopaedics on Monday and brings a child to paediatrics on Tuesday.
-- =============================================================================

-- staff needs a tenant-scoped unique key before a visit can hold a composite
-- FK to it. departments already has one; this is the matching pair for staff.
alter table public.staff
  add constraint staff_hospital_id_id_key unique (hospital_id, id);

create table public.visits (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals(id),
  patient_id     uuid not null,
  visit_no       text not null,
  token_no       integer not null check (token_no > 0),
  visit_type     public.visit_type not null default 'opd',
  doctor_id      uuid,
  department_id  uuid,
  status         public.visit_status not null default 'waiting',
  visited_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  constraint visits_hospital_id_visit_no_key unique (hospital_id, visit_no),
  constraint visits_hospital_id_id_key unique (hospital_id, id),
  -- composite FKs: every reference is pinned to the same hospital
  constraint visits_patient_same_hospital_fkey
    foreign key (hospital_id, patient_id)
    references public.patients (hospital_id, id),
  constraint visits_doctor_same_hospital_fkey
    foreign key (hospital_id, doctor_id)
    references public.staff (hospital_id, id),
  constraint visits_department_same_hospital_fkey
    foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id)
);

-- Two patients cannot both be token 7 today. create_visit allocates the number
-- under an advisory lock; this index is what makes that a guarantee rather
-- than a convention.
create unique index visits_hospital_id_day_token_key
  on public.visits (hospital_id, public.ist_date(visited_at), token_no);

-- The queue screen: one hospital, one day.
create index visits_hospital_id_visited_at_idx
  on public.visits (hospital_id, visited_at desc);

-- A patient's history, and the "last seen" line in patient search.
create index visits_hospital_id_patient_id_visited_at_idx
  on public.visits (hospital_id, patient_id, visited_at desc);

-- The doctor's own queue (Phase 1, doctor module).
create index visits_hospital_id_doctor_id_status_idx
  on public.visits (hospital_id, doctor_id, status);

comment on column public.visits.token_no is
  'Queue token, restarting at 1 each IST day. Deliberately not from number_series: that counter is per financial year, and a token is per day.';
comment on column public.visits.visit_no is
  'Permanent visit number from next_number(), e.g. V/2026-27/00042.';

-- =============================================================================
-- charge_items
--
-- A money table. Written ONLY by RPCs, in one transaction (CLAUDE.md 3.2) --
-- there is no insert or update policy below, so a direct write from app code
-- matches zero rows even if someone tries.
-- =============================================================================
create table public.charge_items (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals(id),
  visit_id       uuid not null,
  service_id     uuid,
  description    text not null,
  qty            numeric(10,2) not null default 1 check (qty > 0),
  unit_price     numeric(12,2) not null check (unit_price >= 0),
  amount         numeric(12,2) not null check (amount >= 0),
  tax_rate       numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  source_module  public.charge_source not null,
  invoice_id     uuid,
  status         public.charge_status not null default 'pending',
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint charge_items_hospital_id_id_key unique (hospital_id, id),
  constraint charge_items_visit_same_hospital_fkey
    foreign key (hospital_id, visit_id)
    references public.visits (hospital_id, id),
  constraint charge_items_service_same_hospital_fkey
    foreign key (hospital_id, service_id)
    references public.services (hospital_id, id),
  -- The line total is not an opinion. Stored, so an invoice reprints exactly
  -- as it was raised; checked, so it cannot drift from its own inputs.
  constraint charge_items_amount_matches_line
    check (amount = round(qty * unit_price, 2)),
  -- An invoiced line belongs to an invoice; a pending or cancelled one does
  -- not. void_invoice releases lines back to pending (CLAUDE.md 4), and this
  -- is what stops it from leaving a dangling invoice_id behind.
  constraint charge_items_invoiced_has_invoice
    check ((status = 'invoiced') = (invoice_id is not null))
);

comment on column public.charge_items.invoice_id is
  'No foreign key yet -- the invoices table arrives with the billing slice and adds it. Null is the normal state: an unbilled charge.';
comment on column public.charge_items.status is
  'pending until collect_payment attaches it to an invoice. Cancelled lines stay for the audit trail.';

-- Unbilled charges for a visit -- what the billing screen opens with.
create index charge_items_hospital_id_visit_id_idx
  on public.charge_items (hospital_id, visit_id, status);

create index charge_items_hospital_id_unbilled_idx
  on public.charge_items (hospital_id, visit_id)
  where invoice_id is null and status = 'pending';

create index charge_items_hospital_id_invoice_id_idx
  on public.charge_items (hospital_id, invoice_id);

create index charge_items_hospital_id_created_at_idx
  on public.charge_items (hospital_id, created_at desc);

-- =============================================================================
-- Audit (CLAUDE.md 3.5). patients, visits and charge_items are all on the list.
-- =============================================================================
create trigger patients_audit
  after insert or update or delete on public.patients
  for each row execute function public.fn_audit();

create trigger visits_audit
  after insert or update or delete on public.visits
  for each row execute function public.fn_audit();

create trigger charge_items_audit
  after insert or update or delete on public.charge_items
  for each row execute function public.fn_audit();

-- services is a master list rather than a money movement, but a price change
-- is exactly the kind of edit someone asks about six months later.
create trigger services_audit
  after insert or update or delete on public.services
  for each row execute function public.fn_audit();

-- =============================================================================
-- RLS
--
-- A coarse safety net only (CLAUDE.md 5). No delete policy anywhere: nothing
-- in this app hard-deletes a row.
-- =============================================================================
alter table public.patients     enable row level security;
alter table public.services     enable row level security;
alter table public.visits       enable row level security;
alter table public.charge_items enable row level security;

-- -----------------------------------------------------------------------------
-- patients -- everyone in the hospital reads (the lab needs the name on a
-- sample, the cashier needs it on a bill). Inserts go through
-- register_patient, which is SECURITY DEFINER and runs its own tenant and role
-- checks, so there is deliberately no insert policy here.
-- -----------------------------------------------------------------------------
create policy patients_select_tenant on public.patients
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

-- Correcting a spelling or adding an address is a desk job, not an admin one.
-- The soft-delete flag is set through the same path.
create policy patients_update_desk on public.patients
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'front_desk')
  )
  with check (hospital_id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- services -- everyone reads the charge master, admins maintain it.
-- -----------------------------------------------------------------------------
create policy services_select_tenant on public.services
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy services_insert_admin on public.services
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy services_update_admin on public.services
  for update to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin())
  with check (hospital_id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- visits -- read by the whole hospital; this is the queue everyone works from.
-- Rows are created only by create_visit. Status moves as the patient moves,
-- which is a desk and clinical action, so update is open to those roles.
-- -----------------------------------------------------------------------------
create policy visits_select_tenant on public.visits
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy visits_update_desk on public.visits
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'front_desk', 'doctor', 'nurse')
  )
  with check (hospital_id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- charge_items -- readable, never writable from the app (CLAUDE.md 3.2).
-- Every write is an RPC running in a single transaction.
-- -----------------------------------------------------------------------------
create policy charge_items_select_tenant on public.charge_items
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

-- =============================================================================
-- visit_queue -- one row per visit, with the names the queue screen prints.
--
-- A view rather than an RPC, so the screen keeps PostgREST filtering and
-- ordering (by day, by status, by doctor) instead of needing a new function
-- argument each time the queue grows a control.
--
-- security_invoker = on: the view runs as the CALLER, so the RLS policies
-- above still decide which rows come back. Without it a view owned by postgres
-- would hand every hospital's queue to anyone who asked (PostgreSQL 15+).
-- =============================================================================
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
  v.created_by
from public.visits v
join public.patients p
  on p.hospital_id = v.hospital_id and p.id = v.patient_id
left join public.staff s
  on s.hospital_id = v.hospital_id and s.id = v.doctor_id
left join public.departments d
  on d.hospital_id = v.hospital_id and d.id = v.department_id
left join lateral (
  select sum(ci.amount) as charge_total
  from public.charge_items ci
  where ci.hospital_id = v.hospital_id
    and ci.visit_id = v.id
    and ci.status <> 'cancelled'
) c on true;

comment on view public.visit_queue is
  'Read model for the queue screen: visit, patient, doctor, department and charges raised so far. security_invoker, so RLS on the underlying tables applies.';

grant select on public.visit_queue to authenticated;

-- =============================================================================
-- Realtime
--
-- The queue screen subscribes to visits for its own hospital. Realtime applies
-- each subscriber's own RLS, so visits_select_tenant is what keeps one
-- hospital's queue out of another hospital's browser.
--
-- Replica identity stays DEFAULT: the subscription filter runs on the new row,
-- which the WAL carries in full for insert and update. FULL would only add the
-- old row, at the cost of WAL volume on every write.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'visits'
  ) then
    alter publication supabase_realtime add table public.visits;
  end if;
end;
$$;

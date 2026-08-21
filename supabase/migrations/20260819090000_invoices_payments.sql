-- =============================================================================
-- 20260819090000_invoices_payments.sql
-- Phase 1 billing: invoices, payments, and the foreign key charge_items has
-- been waiting for.
--
-- charge_items already exists (20260818120000) because create_visit seeds a
-- consultation charge. This file completes the money side of the schema.
--
-- Rules enforced here (CLAUDE.md 3.1, 3.2):
--   * every table carries hospital_id not null references hospitals(id)
--   * invoice_no is unique per HOSPITAL, never globally -- two hospitals both
--     start at INV/2026-27/00001 and neither is wrong
--   * every composite index leads with hospital_id
--   * money is numeric(12,2), never float
--   * neither table has an insert or update policy. Every write goes through
--     an RPC in a single transaction (20260819090100). A direct write from
--     app code matches zero rows.
--   * invoices are never deleted. void_invoice sets a status and a reason, and
--     the number stays consumed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enums (lowercase snake_case values, per CLAUDE.md 4)
-- -----------------------------------------------------------------------------
create type public.invoice_status as enum (
  'unpaid',
  'partial',
  'paid',
  'void'
);

create type public.payment_mode as enum (
  'cash',
  'upi',
  'card',
  'other'
);

comment on type public.payment_mode is
  'How the money arrived. Required on every payment (CLAUDE.md 3.2) -- the day-close report is grouped by it, and "some cash and some UPI" is not a closable day.';

-- =============================================================================
-- invoices
--
-- One invoice per collection event, not per visit: a patient who pays for the
-- consultation in the morning and an X-ray in the afternoon has two invoices
-- against one visit, which is what actually happens at the counter.
--
-- patient_name_snapshot is deliberate (CLAUDE.md 4). A printed bill carries the
-- name as it was on the day; a woman who marries in November does not
-- retrospectively change September's invoice.
-- =============================================================================
create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  hospital_id           uuid not null references public.hospitals(id),
  invoice_no            text not null,
  fy                    text not null check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  visit_id              uuid not null,
  patient_id            uuid not null,
  patient_name_snapshot text not null,
  invoice_date          timestamptz not null default now(),
  subtotal              numeric(12,2) not null default 0 check (subtotal >= 0),
  tax_total             numeric(12,2) not null default 0 check (tax_total >= 0),
  grand_total           numeric(12,2) not null default 0 check (grand_total >= 0),
  status                public.invoice_status not null default 'unpaid',
  void_reason           text,
  created_by            uuid references auth.users(id) on delete set null,

  -- Scoped, never global (CLAUDE.md 3.1). This is also the constraint the
  -- concurrency test leans on: two simultaneous collect_payment calls that
  -- somehow drew the same number would fail here rather than print twice.
  constraint invoices_hospital_id_invoice_no_key unique (hospital_id, invoice_no),
  -- lets payments and charge_items hold a composite FK that pins the tenant
  constraint invoices_hospital_id_id_key unique (hospital_id, id),

  constraint invoices_visit_same_hospital_fkey
    foreign key (hospital_id, visit_id)
    references public.visits (hospital_id, id),
  constraint invoices_patient_same_hospital_fkey
    foreign key (hospital_id, patient_id)
    references public.patients (hospital_id, id),

  -- The total is not an opinion. Stored so a reprint is identical, checked so
  -- it cannot drift from its own parts.
  constraint invoices_grand_total_matches
    check (grand_total = subtotal + tax_total),

  -- Destructive actions require a typed reason (CLAUDE.md 7). This is the
  -- database half of that rule: a void without a reason does not exist, and a
  -- reason on a live invoice is meaningless.
  constraint invoices_void_has_reason
    check ((status = 'void') = (void_reason is not null))
);

comment on table public.invoices is
  'Created only by collect_payment(). Never deleted -- void_invoice() sets status = void and the number stays consumed (CLAUDE.md 3.2).';
comment on column public.invoices.fy is
  'Indian financial year the number was drawn in, as 2026-27. Stored so a report can filter without re-deriving it from invoice_date.';
comment on column public.invoices.patient_name_snapshot is
  'The name as printed. Intentionally not a join -- names change, printed bills do not.';
comment on column public.invoices.visit_id is
  'Every invoice belongs to a visit. Not nullable: a charge with no episode behind it has nothing to reconcile against.';

create index invoices_hospital_id_invoice_date_idx
  on public.invoices (hospital_id, invoice_date desc);

create index invoices_hospital_id_status_idx
  on public.invoices (hospital_id, status);

create index invoices_hospital_id_visit_id_idx
  on public.invoices (hospital_id, visit_id);

create index invoices_hospital_id_patient_id_idx
  on public.invoices (hospital_id, patient_id, invoice_date desc);

-- The invoice list opens on today, and day-close counts the day's bills.
-- ist_date() is IMMUTABLE, so this is an index rather than a filter.
create index invoices_hospital_id_day_idx
  on public.invoices (hospital_id, public.ist_date(invoice_date));

-- =============================================================================
-- payments
--
-- mode and collected_by are NOT NULL (CLAUDE.md 3.2). Between them they answer
-- the only two questions a day-close argument is ever about: which drawer the
-- money is in, and who put it there.
--
-- A payment is never edited into nothing and never deleted. is_reversed plus a
-- reason is the whole correction story, and void_invoice writes it.
-- =============================================================================
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references public.hospitals(id),
  invoice_id      uuid not null,
  amount          numeric(12,2) not null check (amount > 0),
  mode            public.payment_mode not null,
  reference       text,
  -- No ON DELETE clause on purpose. A login that collected money cannot be
  -- deleted out from under the receipt: deactivate the membership instead.
  collected_by    uuid not null references auth.users(id),
  paid_at         timestamptz not null default now(),
  is_reversed     boolean not null default false,
  reversal_reason text,

  constraint payments_hospital_id_id_key unique (hospital_id, id),
  constraint payments_invoice_same_hospital_fkey
    foreign key (hospital_id, invoice_id)
    references public.invoices (hospital_id, id),

  -- Same rule as a void: a reversal without a typed reason does not exist.
  constraint payments_reversal_has_reason
    check (is_reversed = (reversal_reason is not null))
);

comment on table public.payments is
  'Money actually received. Inserted only by collect_payment(); reversed, never deleted, by void_invoice().';
comment on column public.payments.reference is
  'UPI transaction id, card approval code, cheque number. Optional -- cash has none.';
comment on column public.payments.collected_by is
  'auth.users id of the person who took the money. Required (CLAUDE.md 3.2), and never taken from the payload for a signed-in caller.';

create index payments_hospital_id_invoice_id_idx
  on public.payments (hospital_id, invoice_id);

create index payments_hospital_id_paid_at_idx
  on public.payments (hospital_id, paid_at desc);

-- The day-close report: one hospital, one IST day, grouped by mode and by
-- collector. Leads with hospital_id like every composite index here.
create index payments_hospital_id_day_idx
  on public.payments (hospital_id, public.ist_date(paid_at))
  where not is_reversed;

-- =============================================================================
-- charge_items -> invoices
--
-- The column has been there since 20260818120000, with a comment saying this
-- key arrives with the billing slice. Here it is.
-- =============================================================================
alter table public.charge_items
  add constraint charge_items_invoice_same_hospital_fkey
  foreign key (hospital_id, invoice_id)
  references public.invoices (hospital_id, id);

comment on column public.charge_items.invoice_id is
  'The invoice this line was billed on. Null until collect_payment attaches it, and null again after void_invoice releases it back to pending.';

-- =============================================================================
-- Audit (CLAUDE.md 3.5). Both new tables are on the list.
-- =============================================================================
create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function public.fn_audit();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.fn_audit();

-- =============================================================================
-- RLS
--
-- A coarse safety net (CLAUDE.md 5), with a role check because this one is
-- relevant: a bill names a patient, an amount, and a diagnosis-shaped list of
-- services. There is no reason for the lab bench to read it.
--
-- No insert, update or delete policy on either table. collect_payment and
-- void_invoice are SECURITY DEFINER and are the only writers.
--
-- POLICY DECISION, worth revisiting per hospital: the readers below are
-- super_admin, admin and cashier -- the same set the sidebar shows Billing to
-- (lib/nav.ts). In hospitals where reception also takes money, add 'front_desk'
-- here and to BILLING_ROLES in lib/roles.ts. Those two places are the whole
-- change.
-- =============================================================================
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

create policy invoices_select_billing on public.invoices
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'cashier')
  );

create policy payments_select_billing on public.payments
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and public.has_role('super_admin', 'admin', 'cashier')
  );

-- =============================================================================
-- visit_billing -- the read model the collect screen opens with.
--
-- One row per visit, carrying what is still unbilled on it. A view rather than
-- an RPC, for the same reason visit_queue is one: the screen keeps PostgREST
-- filtering and ordering instead of growing a function argument every time it
-- grows a control.
--
-- security_invoker = on: it runs as the CALLER, so the policies decide the
-- rows. Without it, a view owned by postgres hands every hospital's billing
-- queue to anyone who asks (PostgreSQL 15+).
-- =============================================================================
create view public.visit_billing
with (security_invoker = on) as
select
  v.id                            as visit_id,
  v.hospital_id,
  v.visit_no,
  v.token_no,
  v.visit_type,
  v.status                        as visit_status,
  v.visited_at,
  public.ist_date(v.visited_at)   as visit_date,
  v.patient_id,
  p.mrn                           as patient_mrn,
  p.full_name                     as patient_name,
  p.dob                           as patient_dob,
  p.gender                        as patient_gender,
  p.phone                         as patient_phone,
  v.doctor_id,
  s.full_name                     as doctor_name,
  v.department_id,
  d.name                          as department_name,
  coalesce(c.pending_count, 0)    as pending_count,
  coalesce(c.pending_total, 0)    as pending_total,
  coalesce(c.invoiced_total, 0)   as invoiced_total,
  coalesce(i.invoice_count, 0)    as invoice_count
from public.visits v
join public.patients p
  on p.hospital_id = v.hospital_id and p.id = v.patient_id
left join public.staff s
  on s.hospital_id = v.hospital_id and s.id = v.doctor_id
left join public.departments d
  on d.hospital_id = v.hospital_id and d.id = v.department_id
left join lateral (
  select
    count(*) filter (where ci.status = 'pending')        as pending_count,
    sum(ci.amount) filter (where ci.status = 'pending')  as pending_total,
    sum(ci.amount) filter (where ci.status = 'invoiced') as invoiced_total
  from public.charge_items ci
  where ci.hospital_id = v.hospital_id
    and ci.visit_id = v.id
) c on true
left join lateral (
  select count(*) as invoice_count
  from public.invoices inv
  where inv.hospital_id = v.hospital_id
    and inv.visit_id = v.id
    and inv.status <> 'void'
) i on true;

comment on view public.visit_billing is
  'Read model for the collect-payment screen: a visit, who it is for, and what is still unbilled on it. security_invoker, so RLS applies.';

grant select on public.visit_billing to authenticated;

-- =============================================================================
-- invoice_summary -- the invoice list, and the balance line on a receipt.
--
-- paid_total counts only payments that have not been reversed, so a voided
-- invoice reads as zero collected rather than as money the hospital is holding.
-- =============================================================================
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
-- Who raised the bill, by name. A login without a staff record shows blank
-- rather than a uuid.
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
  'Invoice with its patient, visit and the money collected so far. paid_total excludes reversed payments, so balance is what is actually outstanding.';

grant select on public.invoice_summary to authenticated;

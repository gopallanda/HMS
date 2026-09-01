-- =============================================================================
-- 20260902090400_day_closures.sql
-- A day close that actually closes, and the leakage figure next to it.
--
-- WHAT WAS WRONG
--
-- /billing/day-close was read-only. There was no record that a day WAS closed,
-- by whom, or -- the entire reason an owner opens the screen -- what the cash
-- actually counted in the drawer came to against what the system says it took.
-- The variance line was the missing half of the feature.
--
-- Discounts given were invisible too. Once concessions exist
-- (20260902090300), "we collected 41,000" without "and gave away 2,300" is not
-- a day anybody can reconcile: the leakage is the number the owner is looking
-- for and it was nowhere on the sheet.
--
-- WHAT CLOSING DOES NOT DO
--
-- It does not lock anything. CLAUDE.md's own note stands: closing a day is a
-- conversation between a person and a cash box, and a hospital where a
-- 9pm correction is impossible is a hospital that stops closing days. A
-- re-close is an UPDATE, not a delete and re-insert, so the audit trigger
-- carries both figures and somebody can see the drawer was counted twice.
-- =============================================================================

create table public.day_closures (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals(id),
  close_date     date not null,
  -- What was counted out of the drawer by hand.
  declared_cash  numeric(12,2) not null check (declared_cash >= 0),
  -- What day_close_report said the cash line was, snapshotted INSIDE the
  -- closing transaction. Stored rather than recomputed at read time for the
  -- same reason staff_shifts.hours is stored: the variance has to keep meaning
  -- what it meant when two people stood at the counter and agreed it, even
  -- after a late payment lands on the same day.
  system_cash    numeric(12,2) not null,
  variance       numeric(12,2) not null,
  notes          text,
  closed_by      uuid references auth.users(id) on delete set null,
  closed_at      timestamptz not null default now(),

  -- One closure per hospital per day. Re-closing updates this row.
  constraint day_closures_hospital_id_close_date_key unique (hospital_id, close_date)
);

comment on table public.day_closures is
  'That a day was counted, by whom, and how the drawer compared with the system. Written only by close_day(). Closing locks nothing.';
comment on column public.day_closures.system_cash is
  'The cash line from day_close_report at the moment of closing. Snapshotted, not derived: the variance has to stay what the two people at the counter agreed.';
comment on column public.day_closures.variance is
  'declared_cash - system_cash. Positive means more in the drawer than the system knows about.';

create index day_closures_hospital_id_close_date_idx
  on public.day_closures (hospital_id, close_date desc);

create trigger day_closures_audit
  after insert or update or delete on public.day_closures
  for each row execute function public.fn_audit();

-- -----------------------------------------------------------------------------
-- RLS. Coarse, per CLAUDE.md 5.
--
-- Readable by anybody in the hospital who can already reach the report; the
-- route itself is gated on reports.view, and this row says nothing the day
-- close does not. No insert, update or delete policy at all -- close_day() is
-- SECURITY DEFINER and is the only writer, the same arrangement invoices and
-- charge_items use.
-- -----------------------------------------------------------------------------
alter table public.day_closures enable row level security;

create policy day_closures_select_tenant on public.day_closures
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

-- =============================================================================
-- day_close_report gains a discounts figure.
--
-- A fourth 'total' row rather than a new bucket: the screen already reads
-- total/collected, total/invoiced and total/voided by key, and one more key is
-- one more line rather than a new section to lay out.
--
-- Counted on invoices RAISED on the day, alongside 'invoiced', and voided
-- invoices are excluded -- a concession on a bill that was cancelled was never
-- given away. Everything else in this function is 20260819090100 unchanged.
-- =============================================================================
create or replace function public.day_close_report(
  p_hospital_id uuid,
  p_date        date default null
)
returns table (
  bucket      text,
  key         text,
  label       text,
  entry_count bigint,
  amount      numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hospital_id uuid;
  v_date        date;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  v_date        := coalesce(p_date, public.ist_date(now()));

  return query
  with paid as (
    select
      pm.amount,
      pm.mode,
      pm.collected_by,
      i.visit_id
    from public.payments pm
    join public.invoices i
      on i.hospital_id = pm.hospital_id and i.id = pm.invoice_id
    where pm.hospital_id = v_hospital_id
      and not pm.is_reversed
      and public.ist_date(pm.paid_at) = v_date
  ),
  billed as (
    select i.status, i.grand_total, i.discount_amount
    from public.invoices i
    where i.hospital_id = v_hospital_id
      and public.ist_date(i.invoice_date) = v_date
  )

  select
    'total'::text,
    'collected'::text,
    'Collected'::text,
    count(*)::bigint,
    coalesce(sum(p.amount), 0)::numeric
  from paid p

  union all
  select
    'total', 'invoiced', 'Billed',
    count(*)::bigint,
    coalesce(sum(b.grand_total), 0)::numeric
  from billed b
  where b.status <> 'void'

  union all
  select
    'total', 'voided', 'Voided',
    count(*)::bigint,
    coalesce(sum(b.grand_total), 0)::numeric
  from billed b
  where b.status = 'void'

  -- ---------------------------------------------------------------------------
  -- Given away. The leakage line, next to the collections rather than buried
  -- in a report nobody opens. entry_count is the number of bills that carried
  -- a concession, which on its own tells an owner whether this is one
  -- exception or a habit.
  -- ---------------------------------------------------------------------------
  union all
  select
    'total', 'discounted', 'Concessions',
    count(*)::bigint,
    coalesce(sum(b.discount_amount), 0)::numeric
  from billed b
  where b.status <> 'void'
    and b.discount_amount > 0

  union all
  select
    'mode',
    m.mode::text,
    case m.mode
      when 'cash'  then 'Cash'
      when 'upi'   then 'UPI'
      when 'card'  then 'Card'
      when 'other' then 'Other'
    end,
    count(p.amount)::bigint,
    coalesce(sum(p.amount), 0)::numeric
  from unnest(enum_range(null::public.payment_mode)) as m(mode)
  left join paid p on p.mode = m.mode
  group by m.mode

  union all
  select
    'staff',
    p.collected_by::text,
    coalesce(max(s.full_name), 'Login with no staff record'),
    count(*)::bigint,
    sum(p.amount)::numeric
  from paid p
  left join public.staff s
    on s.hospital_id = v_hospital_id and s.user_id = p.collected_by
  group by p.collected_by

  union all
  select
    'department',
    coalesce(v.department_id::text, 'none'),
    coalesce(max(d.name), 'No department'),
    count(*)::bigint,
    sum(p.amount)::numeric
  from paid p
  join public.visits v
    on v.hospital_id = v_hospital_id and v.id = p.visit_id
  left join public.departments d
    on d.hospital_id = v_hospital_id and d.id = v.department_id
  group by v.department_id;
end;
$$;

comment on function public.day_close_report(uuid, date) is
  'Read-only day close for one IST day: totals (collected, billed, voided, concessions given), plus collections by payment mode, by collecting staff and by department. Excludes reversed payments.';

revoke execute on function public.day_close_report(uuid, date) from public, anon;
grant execute on function public.day_close_report(uuid, date) to authenticated;

-- =============================================================================
-- close_day(p_hospital_id, p_date, p_declared_cash, p_notes) -> day_closures
--
-- The system figure is read from day_close_report INSIDE this transaction, so
-- the variance is against the same numbers the person closing was looking at
-- rather than against whatever the table says a moment later.
-- =============================================================================
create or replace function public.close_day(
  p_hospital_id   uuid default null,
  p_date          date default null,
  p_declared_cash numeric default 0,
  p_notes         text default null
)
returns public.day_closures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_date        date;
  v_declared    numeric(12,2);
  v_system      numeric(12,2);
  v_notes       text;
  v_closure     public.day_closures;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_billing();

  v_date := coalesce(p_date, public.ist_date(now()));

  -- A day that has not happened cannot have been counted. Today IS closable:
  -- an OPD counter shuts at seven and the day is over long before midnight.
  if v_date > public.ist_date(now()) then
    raise exception 'Cannot close %: that day has not happened yet.',
      to_char(v_date, 'DD Mon YYYY');
  end if;

  v_declared := round(coalesce(p_declared_cash, 0), 2);
  if v_declared < 0 then
    raise exception 'The cash counted cannot be negative.';
  end if;

  -- The cash line only. Card and UPI settle into a bank account and are
  -- nobody's counting problem at the counter; the drawer is what a variance is
  -- about.
  select coalesce(r.amount, 0) into v_system
  from public.day_close_report(v_hospital_id, v_date) r
  where r.bucket = 'mode' and r.key = 'cash';

  v_system := round(coalesce(v_system, 0), 2);
  v_notes  := nullif(btrim(coalesce(p_notes, '')), '');

  -- Re-closing is an UPDATE. Deleting and re-inserting would leave the audit
  -- log saying a closure was destroyed and another created, which reads as
  -- something being covered up rather than as a drawer counted twice.
  insert into public.day_closures (
    hospital_id, close_date, declared_cash, system_cash, variance, notes, closed_by
  )
  values (
    v_hospital_id, v_date, v_declared, v_system, v_declared - v_system, v_notes, auth.uid()
  )
  on conflict (hospital_id, close_date) do update
    set declared_cash = excluded.declared_cash,
        system_cash   = excluded.system_cash,
        variance      = excluded.variance,
        notes         = excluded.notes,
        closed_by     = excluded.closed_by,
        closed_at     = now()
  returning * into v_closure;

  return v_closure;
end;
$$;

comment on function public.close_day(uuid, date, numeric, text) is
  'Records that a day was counted: the cash declared at the counter against the cash the system says was taken, with the variance. Snapshots system_cash inside the transaction. Re-closing updates the row; closing locks nothing.';

revoke execute on function public.close_day(uuid, date, numeric, text) from public, anon;
grant execute on function public.close_day(uuid, date, numeric, text) to authenticated;

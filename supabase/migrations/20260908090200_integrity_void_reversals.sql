-- =============================================================================
-- 20260908090200_integrity_void_reversals.sql
-- A void is one event, not one plus one per payment on the bill.
--
-- WHAT WAS WRONG
--
-- void_invoice() (20260819090100) reverses every payment on the bill as part
-- of retiring it, writing the VOID's reason onto each payment row:
--
--     update public.payments pm
--        set is_reversed = true, reversal_reason = v_reason
--      where ... and not pm.is_reversed;
--
-- The payments_audit trigger fires on each of those, so 20260908090000 saw one
-- `void` event and one `reversal` event per payment -- same actor, same
-- instant, same reason text -- and counted them all. On the hosted project
-- that showed up immediately: Sunrise reported 4 voids and 4 reversals by the
-- service role for identical amounts, because they were the same four acts
-- seen twice.
--
-- It is not a cosmetic double count. The per-person table is the headline of
-- the screen and it is ranked on the number of events, so voiding a paid bill
-- moved somebody up the table twice as fast as voiding an unpaid one -- which
-- is a fact about whether the patient had paid yet, not about the person.
--
-- THE FIX
--
-- A reversal that happened inside a void is not an independent decision, so it
-- is not a separate event. The void's own row already carries grand_total, so
-- no money leaves the report.
--
-- Detected by the timestamp: audit_log.at defaults to now(), which in Postgres
-- is the TRANSACTION start time, so the invoice's void row and the payment
-- reversals it caused share an `at` exactly. reverse_payment() cannot collide
-- with this -- it never sets an invoice to void, so there is no matching row
-- to find -- and neither can two unrelated acts, because a void and a manual
-- reversal of the same invoice in the same transaction is not a thing any
-- caller can construct.
--
-- Everything else in the function is 20260908090000 unchanged; it is repeated
-- in full because CREATE OR REPLACE FUNCTION takes a whole body.
-- =============================================================================

create or replace function public.cash_integrity_report(
  p_hospital_id uuid    default null,
  p_from        date    default null,
  p_to          date    default null,
  p_limit       integer default 500
)
returns table (
  bucket            text,
  kind              text,
  actor_id          uuid,
  actor_name        text,
  entry_count       bigint,
  amount            numeric,
  after_close_count bigint,
  event_id          uuid,
  occurred_at       timestamptz,
  invoice_id        uuid,
  invoice_no        text,
  patient_name      text,
  reason            text,
  detail            text,
  after_close       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hospital_id uuid;
  v_from        date;
  v_to          date;
  v_limit       integer;
  v_from_at     timestamptz;
  v_to_at       timestamptz;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);

  -- THE boundary. SECURITY DEFINER is not optional here -- audit_log is
  -- readable only by is_hospital_admin() and half this report lives in it --
  -- which means RLS cannot be the guard and this check is the only one there
  -- is. PostgREST will call this function with a nurse's JWT if asked; the
  -- route guard and the nav are not boundaries (CLAUDE.md 3.6).
  --
  -- A null app_role() is no session at all: service role, seed, migration,
  -- trusted by definition. The same exemption assert_billing() makes.
  if public.app_role() is not null
     and not public.has_permission('reports.integrity') then
    raise exception 'Your role is not allowed to open the integrity report (reports.integrity).'
      using errcode = '42501';
  end if;

  -- A week, ending today, is the default: one day is too short to tell an
  -- exception from a habit, which is the only question this report exists to
  -- answer.
  v_to   := coalesce(p_to, public.ist_date(now()));
  v_from := coalesce(p_from, v_to - 6);

  if v_from > v_to then
    raise exception 'That range starts after it ends.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 500), 1), 2000);

  -- IST day boundaries as timestamptz, so the audit_log scan can use
  -- audit_log_hospital_id_at_idx. `ist_date(al.at) between ...` is the same
  -- answer and cannot use that index -- it wraps the indexed column in a
  -- function call. IST has no DST, so the two forms agree exactly and always.
  v_from_at := (v_from::timestamp)      at time zone 'Asia/Kolkata';
  v_to_at   := ((v_to + 1)::timestamp)  at time zone 'Asia/Kolkata';

  return query
  with prints as (
    -- Ranked over the invoice's WHOLE print history, not over the window: the
    -- third copy of a receipt is the third copy even when the first two went
    -- out last month. The window is applied after the ranking, below.
    select
      al.id        as event_id,
      al.at        as occurred_at,
      al.actor_id  as actor_id,
      al.record_id as invoice_id,
      al.after ->> 'format' as format,
      row_number() over (partition by al.record_id order by al.at) as print_no
    from public.audit_log al
    where al.hospital_id = v_hospital_id
      and al.table_name  = 'receipt_print'
  ),

  events as (
    -- ---- void: an invoice retired -------------------------------------------
    select
      al.id                            as event_id,
      'void'::text                     as kind,
      al.at                            as occurred_at,
      al.actor_id                      as actor_id,
      i.id                             as invoice_id,
      i.invoice_no                     as invoice_no,
      i.patient_name_snapshot          as patient_name,
      i.grand_total                    as amount,
      (al.after ->> 'void_reason')     as reason,
      null::text                       as detail,
      public.ist_date(i.invoice_date)  as business_date
    from public.audit_log al
    join public.invoices i
      on i.hospital_id = al.hospital_id and i.id = al.record_id
    where al.hospital_id = v_hospital_id
      and al.table_name  = 'invoices'
      and al.action      = 'update'
      and al.at >= v_from_at and al.at < v_to_at
      -- The transition, not the state: an invoice edited while already void
      -- was not voided a second time.
      and coalesce(al.after  ->> 'status', '') =  'void'
      and coalesce(al.before ->> 'status', '') <> 'void'

    union all

    -- ---- reversal: a payment undone -----------------------------------------
    -- Read out of the audit payload rather than off the payment row, so the
    -- figures are the ones as they stood when the reversal happened.
    select
      al.id,
      'reversal',
      al.at,
      al.actor_id,
      i.id,
      i.invoice_no,
      i.patient_name_snapshot,
      (al.after ->> 'amount')::numeric,
      (al.after ->> 'reversal_reason'),
      'Had been collected as ' || coalesce(al.after ->> 'mode', 'unknown'),
      public.ist_date((al.after ->> 'paid_at')::timestamptz)
    from public.audit_log al
    join public.payments pm
      on pm.hospital_id = al.hospital_id and pm.id = al.record_id
    join public.invoices i
      on i.hospital_id = pm.hospital_id and i.id = pm.invoice_id
    where al.hospital_id = v_hospital_id
      and al.table_name  = 'payments'
      and al.action      = 'update'
      and al.at >= v_from_at and al.at < v_to_at
      and      coalesce((al.after  ->> 'is_reversed')::boolean, false)
      and not  coalesce((al.before ->> 'is_reversed')::boolean, false)
      -- ...and it was not simply part of voiding the bill. void_invoice()
      -- reverses every payment on the invoice and writes the VOID's reason
      -- onto each one, so without this every void of a paid bill counted
      -- twice: once here and once as a void. audit_log.at is now(), which is
      -- the TRANSACTION timestamp, so the two rows share it exactly.
      and not exists (
        select 1
        from public.audit_log v
        where v.hospital_id = al.hospital_id
          and v.table_name  = 'invoices'
          and v.record_id   = pm.invoice_id
          and v.at          = al.at
          and coalesce(v.after ->> 'status', '') = 'void'
      )

    union all

    -- ---- reprint: the second copy onwards -----------------------------------
    select
      p.event_id,
      'reprint',
      p.occurred_at,
      p.actor_id,
      i.id,
      i.invoice_no,
      i.patient_name_snapshot,
      i.grand_total,
      null::text,
      'Copy ' || p.print_no::text || ', ' || coalesce(p.format, 'unknown') || ' paper',
      public.ist_date(i.invoice_date)
    from prints p
    join public.invoices i
      on i.hospital_id = v_hospital_id and i.id = p.invoice_id
    where p.print_no > 1
      and p.occurred_at >= v_from_at and p.occurred_at < v_to_at

    union all

    -- ---- discount: a concession given ---------------------------------------
    -- A void bill is excluded: a concession on a bill that was cancelled was
    -- never given away. The same position day_close_report takes on its own
    -- concessions line.
    --
    -- The percentage is the useful half of a concession. Five hundred rupees
    -- off is a rounding-down at one counter and the whole bill at another, and
    -- only one of those is worth a conversation. grand_total is already net of
    -- the discount (20260902090300), so the gross is subtotal + tax_total.
    select
      i.id,
      'discount',
      i.invoice_date,
      i.created_by,
      i.id,
      i.invoice_no,
      i.patient_name_snapshot,
      i.discount_amount,
      i.discount_reason,
      round(i.discount_amount * 100 / nullif(i.subtotal + i.tax_total, 0))::text
        || '% of the bill',
      public.ist_date(i.invoice_date)
    from public.invoices i
    where i.hospital_id = v_hospital_id
      and i.discount_amount > 0
      and i.status <> 'void'
      and i.invoice_date >= v_from_at and i.invoice_date < v_to_at

    union all

    -- ---- deferral: seen before paying ---------------------------------------
    select
      d.id,
      'deferral',
      d.created_at,
      d.approved_by,
      i.id,
      i.invoice_no,
      i.patient_name_snapshot,
      i.grand_total,
      d.reason,
      null::text,
      public.ist_date(i.invoice_date)
    from public.visit_payment_deferrals d
    join public.invoices i
      on i.hospital_id = d.hospital_id and i.id = d.invoice_id
    where d.hospital_id = v_hospital_id
      and d.created_at >= v_from_at and d.created_at < v_to_at
  ),

  named as (
    select
      e.*,
      -- The person, by the name on their contract. A null actor_id is a
      -- service-role or seed write and says so rather than being blamed on
      -- somebody; a non-null one with no staff row is a login that was never
      -- given a staff record, which is itself worth seeing.
      case
        when e.actor_id is null then 'System or service role'
        else coalesce(s.full_name, 'Login with no staff record')
      end as actor_name,
      exists (
        select 1
        from public.day_closures dc
        where dc.hospital_id = v_hospital_id
          and dc.close_date  = e.business_date
          and dc.closed_at   < e.occurred_at
      ) as after_close
    from events e
    left join public.staff s
      on s.hospital_id = v_hospital_id and s.user_id = e.actor_id
  )

  -- The league table. Over the whole range, never capped.
  select
    'summary'::text,
    n.kind,
    n.actor_id,
    max(n.actor_name),
    count(*)::bigint,
    coalesce(sum(n.amount), 0)::numeric,
    count(*) filter (where n.after_close)::bigint,
    null::uuid,
    null::timestamptz,
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::text,
    null::boolean
  from named n
  group by n.kind, n.actor_id

  union all

  -- The events themselves, newest first, capped. Ordered inside the subquery
  -- because a UNION ALL promises no order of its own -- the caller sorts each
  -- bucket again, the way groupDayClose() does.
  select
    'event'::text,
    n.kind,
    n.actor_id,
    n.actor_name,
    null::bigint,
    n.amount,
    null::bigint,
    n.event_id,
    n.occurred_at,
    n.invoice_id,
    n.invoice_no,
    n.patient_name,
    n.reason,
    n.detail,
    n.after_close
  from (
    select nn.* from named nn order by nn.occurred_at desc limit v_limit
  ) n;
end;
$$;

comment on function public.cash_integrity_report(uuid, date, date, integer) is
  'Voids, reversals (excluding the ones a void causes), reprints, concessions and deferrals over an IST date range, flagged when they landed on a day already closed. Two buckets: an uncapped per-person summary and a capped event list, from one snapshot. Gated on reports.integrity.';

revoke execute on function public.cash_integrity_report(uuid, date, date, integer)
  from public, anon;
grant execute on function public.cash_integrity_report(uuid, date, date, integer)
  to authenticated;

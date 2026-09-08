-- =============================================================================
-- 20260908090000_cash_integrity_report.sql
-- Who voided, discounted, deferred, reversed and reprinted -- and when.
--
-- WHY
--
-- Every fact this report needs has been written since block 1 and none of it
-- has ever been readable. invoices.void_reason says a bill was retired but not
-- by whom -- invoices.created_by is whoever RAISED it. payments.reversal_reason
-- says a collection was undone but not when. log_receipt_print() has counted
-- trips to the printer since 20260829090100 and nothing has ever read one back.
-- The data was audit grade and the product was blind to it.
--
-- That is the wrong way round for the person who signs the cheque. A small
-- hospital does not buy this software to type faster; it buys it to find out
-- where the money goes. day_close_report answers "what came in today". This
-- answers "what did not, and who decided that".
--
-- FIVE KINDS OF EVENT, AND ONE FLAG
--
--   void      An invoice retired. From audit_log: the actor lives nowhere else.
--   reversal  A payment undone. From audit_log, for the same reason.
--   reprint   The SECOND or later trip to the printer for one invoice. The
--             first print is the receipt; every one after it is another piece
--             of paper for the same money, which is how one payment ends up
--             collected twice at two windows.
--   discount  A concession. From invoices directly -- discount_amount is
--             written once, by collect_payment, and nothing updates it
--             afterwards (20260902090300), so the row carries its own actor
--             and its own time.
--   deferral  Somebody let through without paying. From
--             visit_payment_deferrals directly, same reason.
--
-- The flag is `after_close`: the event landed on a business day somebody had
-- already counted the drawer for. A void on today's bill is a correction; a
-- void on a bill from a day closed last Tuesday is a different conversation,
-- and until now nothing in the product could tell the two apart.
--
-- It is measured against the LATEST close of that day, because
-- day_closures.closed_at is updated by a re-close rather than duplicated
-- (20260902090400). An event between a first count and a re-count therefore
-- reads as before-close once the day is counted again. That is a deliberate
-- limit and not a hidden one: the re-close is itself an audit_log row, and
-- reconstructing closure history is a different report from this one.
--
-- WINDOWED ON WHEN THE EVENT HAPPENED, never on the day of the bill it
-- touched. "What was done this week" is the question being asked;
-- `after_close` is what says the thing done this week reached backwards.
--
-- TWO BUCKETS, ONE ROUND TRIP -- the shape day_close_report uses, and for the
-- same reason: every section comes from one snapshot. `summary` is counted
-- over the WHOLE range and is never capped. `event` is the detail list and is.
-- A league table computed in TypeScript from a capped list of events would
-- under-report precisely the person generating the most of them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- has_permission(key) -- the app's permission model, answerable in SQL.
--
-- Until now the database could only ask what MEMBERSHIP role a caller holds
-- (app_role(), has_role(), is_hospital_admin()). That is the coarse safety net
-- RLS is built on and it is deliberately not the product's permission model:
-- CLAUDE.md 3.6 is explicit that permissions, not role names, are the boundary,
-- because an administrator can invent a role at /admin/roles without a deploy
-- and a role-name check locks every custom role out of everything.
--
-- Guarding this report on is_hospital_admin() would have reproduced exactly
-- that bug: an administrator could tick reports.integrity for their "Owner" or
-- "Auditor" role, the nav would show it, the route guard would allow it, and
-- the database would refuse it. A permission that grants nothing reads as a
-- broken screen.
--
-- This is not a new model -- it is my_access() asking about one key instead of
-- returning all of them, over the same staff -> roles -> role_permissions path
-- with the same super_admin override and the same no-staff-record fallback
-- that resolveAccess() and fallbackAccess() apply in lib/rbac/resolve.ts. Two
-- implementations of one rule must agree, so this one is written by reading
-- that file rather than by inventing a second rule.
--
-- SECURITY DEFINER for the reason my_access() is: the answer must not depend
-- on which rows the caller's own policies let them read.
-- -----------------------------------------------------------------------------
create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- super_admin is the one membership role that overrides the staff role.
    -- It already opens every write policy in the database, so withholding a
    -- permission from it here would be theatre (CLAUDE.md 3.6). `admin` is
    -- deliberately absent: a hospital's Manager carries the legacy value
    -- 'admin' so RLS lets it write staff, and widening this would hand every
    -- manager the two keys the Manager role exists to exclude.
    public.has_role('super_admin')

    or exists (
      select 1
      from public.staff s
      join public.role_permissions rp on rp.role_id = s.role_id
      where s.user_id = (select auth.uid())
        and s.hospital_id = public.app_hospital_id()
        and rp.permission_key = p_key
    )

    -- fallbackAccess(): an ADMIN login with no staff record at all holds
    -- everything. Not hypothetical -- a founder provisioned before staff
    -- records existed has a membership, a hospital and nothing else. It grants
    -- them nothing they did not already have, since is_hospital_admin() opens
    -- every write policy anyway. The join to roles matches my_access()'s own
    -- shape, so a staff row with no role_id falls through here identically.
    or (
      public.is_hospital_admin()
      and not exists (
        select 1
        from public.staff s
        join public.roles r on r.id = s.role_id
        where s.user_id = (select auth.uid())
          and s.hospital_id = public.app_hospital_id()
      )
    );
$$;

comment on function public.has_permission(text) is
  'Whether the caller holds one permission key, by the same rule lib/rbac/resolve.ts applies: the staff role''s role_permissions, overridden by a super_admin membership, with an admin login that has no staff record falling back to everything.';

revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- =============================================================================
-- cash_integrity_report(hospital, from, to, limit)
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
  'Voids, reversals, reprints, concessions and deferrals over an IST date range, flagged when they landed on a day already closed. Two buckets: an uncapped per-person summary and a capped event list, from one snapshot. Gated on reports.integrity.';

revoke execute on function public.cash_integrity_report(uuid, date, date, integer)
  from public, anon;
grant execute on function public.cash_integrity_report(uuid, date, date, integer)
  to authenticated;

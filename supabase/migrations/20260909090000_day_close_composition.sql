-- =============================================================================
-- 20260909090000_day_close_composition.sql
-- What the money on a day was FOR, who it came from, and what was given away.
--
-- WHAT WAS WRONG
--
-- day_close_report answered "how much, how, and by whom". It never answered
-- "for what". An owner reading "IPD -- 3 -- 1,100.00" cannot tell whether that
-- is three patients or one, nor whether it is a bed, a consultation and a
-- dressing or three of anything else. The department line is a heading with no
-- page under it.
--
-- Three new buckets and one supporting total. No new tables, and no new round
-- trip: the screen already reads this function once and splits the flat result
-- by `bucket`, so the whole page still comes from a single snapshot.
--
--   patient      Collections grouped by the patient who paid. Reconciles to
--                Collected, exactly like mode, staff and department do.
--   service      The charge LINES of the day by service. Reconciles to Billed
--                plus concessions, NOT to Collected -- see the note below.
--   concession   One row per bill that carried a discount: the bill, the
--                patient, the reason typed at the time, and who raised it.
--                The total was already on the screen; a total is not something
--                an owner can act on.
--
-- WHY `service` DOES NOT ADD UP TO WHAT WAS COLLECTED
--
-- A payment is against an INVOICE. It is not allocated to the lines on that
-- invoice, and inventing an allocation rule for a partial payment would
-- produce a per-service figure that looks authoritative and is made up. So the
-- service bucket is measured over the lines of bills RAISED on the day -- the
-- same population the `invoiced` and `discounted` totals already use -- and
-- charge_items.amount is the pre-tax line total, which its own CHECK
-- constraint (amount = round(qty * unit_price, 2)) guarantees. The identity
-- the screen prints underneath is therefore exact:
--
--   sum(lines) + tax - concessions = billed
--
-- which is why the `tax` total below exists: not a headline anybody reads, but
-- the term that makes that line balance without the page guessing at it.
-- Hospital services are largely GST-exempt (CLAUDE.md 8), so on most days it
-- is zero and the bridge is one subtraction.
--
-- Printing the bridge is the whole point. A section that silently fails to
-- match the headline above it is worse than no section at all.
--
-- THE RETURN TYPE GAINS THREE COLUMNS
--
-- bucket/key/label/entry_count/amount had nowhere to put a concession reason
-- or the name of the person who allowed it. `detail`, `note` and `actor_name`
-- are null in every pre-existing bucket, which is the shape
-- cash_integrity_report (20260908090000) already uses for the same reason.
-- Changing a function return type means dropping and recreating it;
-- close_day() and seed.sql select from it by column NAME and are unaffected.
--
-- Service categories come back as the raw enum value, not a display label.
-- lib/services.ts is the one place a category is given a name -- its own
-- header says so -- and a second spelling in SQL is how a category ends up
-- called two different things on two screens.
-- =============================================================================

drop function if exists public.day_close_report(uuid, date);

create function public.day_close_report(
  p_hospital_id uuid,
  p_date        date default null
)
returns table (
  bucket      text,
  key         text,
  label       text,
  -- Secondary line. The category of a service, the MRN of a patient, the name
  -- on a discounted bill. Null in the buckets that predate this migration.
  detail      text,
  -- Free text typed by a person: the reason a concession was given.
  note        text,
  -- Who allowed it. Resolved here rather than returned as a uuid because
  -- invoices.created_by points at auth.users and the name lives on staff.
  actor_name  text,
  entry_count bigint,
  amount      numeric
)
language plpgsql
stable
set search_path = ''
as $fn$
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
      i.visit_id,
      i.patient_id,
      i.patient_name_snapshot
    from public.payments pm
    join public.invoices i
      on i.hospital_id = pm.hospital_id and i.id = pm.invoice_id
    where pm.hospital_id = v_hospital_id
      and not pm.is_reversed
      and public.ist_date(pm.paid_at) = v_date
  ),
  billed as (
    select
      i.id,
      i.invoice_no,
      i.status,
      i.grand_total,
      i.tax_total,
      i.discount_amount,
      i.discount_reason,
      i.patient_name_snapshot,
      i.created_by
    from public.invoices i
    where i.hospital_id = v_hospital_id
      and public.ist_date(i.invoice_date) = v_date
  ),
  -- The lines behind the bills raised today. Void bills are excluded here
  -- rather than filtered afterwards: void_invoice releases its lines back to
  -- pending and clears invoice_id, so most would fall out of the join anyway,
  -- but saying it once is cheaper than reasoning about it again in a year.
  lines as (
    select
      ci.service_id,
      ci.description,
      ci.amount,
      s.name     as service_name,
      s.category as category
    from public.charge_items ci
    join public.invoices i
      on i.hospital_id = ci.hospital_id and i.id = ci.invoice_id
    left join public.services s
      on s.hospital_id = ci.hospital_id and s.id = ci.service_id
    where ci.hospital_id = v_hospital_id
      and ci.status = 'invoiced'
      and i.status <> 'void'
      and public.ist_date(i.invoice_date) = v_date
  )

  select
    'total'::text,
    'collected'::text,
    'Collected'::text,
    null::text, null::text, null::text,
    count(*)::bigint,
    coalesce(sum(p.amount), 0)::numeric
  from paid p

  union all
  select
    'total', 'invoiced', 'Billed',
    null::text, null::text, null::text,
    count(*)::bigint,
    coalesce(sum(b.grand_total), 0)::numeric
  from billed b
  where b.status <> 'void'

  union all
  select
    'total', 'voided', 'Voided',
    null::text, null::text, null::text,
    count(*)::bigint,
    coalesce(sum(b.grand_total), 0)::numeric
  from billed b
  where b.status = 'void'

  union all
  select
    'total', 'discounted', 'Concessions',
    null::text, null::text, null::text,
    count(*)::bigint,
    coalesce(sum(b.discount_amount), 0)::numeric
  from billed b
  where b.status <> 'void'
    and b.discount_amount > 0

  -- The tax the live bills of the day carried. entry_count is how many bills
  -- were taxable at all: zero on an OPD-only day, not zero once a pharmacy
  -- sale lands on the same sheet.
  union all
  select
    'total', 'tax', 'Tax',
    null::text, null::text, null::text,
    count(*) filter (where b.tax_total > 0)::bigint,
    coalesce(sum(b.tax_total), 0)::numeric
  from billed b
  where b.status <> 'void'

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
    null::text, null::text, null::text,
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
    null::text, null::text, null::text,
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
    null::text, null::text, null::text,
    count(*)::bigint,
    sum(p.amount)::numeric
  from paid p
  join public.visits v
    on v.hospital_id = v_hospital_id and v.id = p.visit_id
  left join public.departments d
    on d.hospital_id = v_hospital_id and d.id = v.department_id
  group by v.department_id

  -- ---------------------------------------------------------------------------
  -- Who the money came from.
  --
  -- Grouped on patient_id, labelled with the name SNAPSHOT off the invoice
  -- rather than the current patients row, for the reason that column exists at
  -- all (CLAUDE.md 4): this sheet is read next to printed bills and has to
  -- agree with them. max() picks one when a patient was billed twice in a day
  -- under two spellings -- which is itself worth seeing on this screen.
  --
  -- The MRN goes in `detail` because a name is not an identifier in a hospital
  -- where three families share a surname.
  -- ---------------------------------------------------------------------------
  union all
  select
    'patient',
    p.patient_id::text,
    max(p.patient_name_snapshot),
    max(pt.mrn),
    null::text, null::text,
    count(*)::bigint,
    sum(p.amount)::numeric
  from paid p
  left join public.patients pt
    on pt.hospital_id = v_hospital_id and pt.id = p.patient_id
  group by p.patient_id

  -- ---------------------------------------------------------------------------
  -- What the work WAS.
  --
  -- Grouped on the service, not on the line description: a consultation line
  -- reads "Consultation - Dr Rao", and three doctors would otherwise be three
  -- rows nobody asked for. Ad-hoc lines have no service_id and keep their own
  -- description as the group, folded case-insensitively so "Dressing" and
  -- "dressing" do not split into two.
  -- ---------------------------------------------------------------------------
  union all
  select
    'service',
    coalesce(l.service_id::text, 'adhoc:' || lower(btrim(l.description))),
    coalesce(max(l.service_name), max(l.description)),
    max(l.category::text),
    null::text, null::text,
    count(*)::bigint,
    sum(l.amount)::numeric
  from lines l
  group by coalesce(l.service_id::text, 'adhoc:' || lower(btrim(l.description)))

  -- ---------------------------------------------------------------------------
  -- Every concession, one row each.
  --
  -- Not aggregated, deliberately. The total was already on the screen and it
  -- is not a number anybody can act on; the bill, the patient, the reason
  -- somebody typed at the counter and the name against it are what turn "we
  -- gave away 2,300" into a conversation.
  --
  -- created_by, not an approver: nothing in the schema records a second person
  -- authorising a discount, and implying one here would be a fiction. This is
  -- who raised the bill that carried it.
  -- ---------------------------------------------------------------------------
  union all
  select
    'concession',
    b.id::text,
    b.invoice_no,
    b.patient_name_snapshot,
    b.discount_reason,
    s.full_name,
    1::bigint,
    b.discount_amount::numeric
  from billed b
  left join public.staff s
    on s.hospital_id = v_hospital_id and s.user_id = b.created_by
  where b.status <> 'void'
    and b.discount_amount > 0;
end;
$fn$;

comment on function public.day_close_report(uuid, date) is
  'Read-only day close for one IST day: totals (collected, billed, voided, concessions, tax), collections by payment mode, by collecting staff, by department and by patient, the charge lines of the day by service, and one row per concession with its reason. Excludes reversed payments and void bills. The service bucket is measured on bills RAISED on the day and reconciles to billed plus concessions, not to collected -- payments are not allocated to lines.';

revoke execute on function public.day_close_report(uuid, date) from public, anon;
grant execute on function public.day_close_report(uuid, date) to authenticated;

-- =============================================================================
-- 20260818090400_next_number.sql
-- next_number(p_hospital_id, p_key) -> text
--
-- CLAUDE.md 3.2: numbers come from number_series via SELECT ... FOR UPDATE.
-- Never a Postgres sequence -- a sequence is global (not per hospital, not per
-- financial year) and leaks gaps on rollback. An invoice book with holes in it
-- is an audit problem.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Indian financial year: 1 Apr - 31 Mar, rendered as 2026-27.
-- Resolved in Asia/Kolkata regardless of server timezone -- the hospital is in
-- India, the database may not be.
-- -----------------------------------------------------------------------------
create or replace function public.financial_year(p_at timestamptz default now())
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp;
  v_start int;
begin
  v_local := p_at at time zone 'Asia/Kolkata';

  if extract(month from v_local)::int >= 4 then
    v_start := extract(year from v_local)::int;
  else
    v_start := extract(year from v_local)::int - 1;
  end if;

  return v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');
end;
$$;

comment on function public.financial_year(timestamptz) is
  'Indian financial year for a moment in time, as 2026-27. Apr 1 to Mar 31, evaluated in Asia/Kolkata.';

-- -----------------------------------------------------------------------------
-- next_number
--
-- SECURITY DEFINER: number_series has no insert/update policy, because no
-- client may ever move a counter directly. This function is the only writer.
--
-- Transaction note: the row lock is held until the CALLING transaction ends.
-- Callers must therefore allocate the number inside the same transaction that
-- writes the row using it (collect_payment does exactly this), so a rollback
-- returns the number instead of burning it.
-- -----------------------------------------------------------------------------
create or replace function public.next_number(
  p_hospital_id uuid,
  p_key public.number_key
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fy      text;
  v_current bigint;
  v_next    bigint;
  v_prefix  text;
  v_claim   uuid;
begin
  if p_hospital_id is null then
    raise exception 'next_number: p_hospital_id is required';
  end if;

  -- Tenant guard. A signed-in caller may only draw numbers for their own
  -- hospital. app_hospital_id() is null for service-role and migration/seed
  -- callers, which are trusted by definition and are allowed through.
  v_claim := public.app_hospital_id();
  if v_claim is not null and v_claim <> p_hospital_id then
    raise exception 'next_number: cross-tenant access denied'
      using errcode = '42501';
  end if;

  v_fy := public.financial_year();

  -- Make sure the counter row exists. Under a concurrent first call, the loser
  -- of the race blocks here until the winner commits, then does nothing --
  -- so the SELECT ... FOR UPDATE below always finds a committed row.
  insert into public.number_series (hospital_id, key, fy, current_value)
  values (p_hospital_id, p_key, v_fy, 0)
  on conflict (hospital_id, key, fy) do nothing;

  select ns.current_value
    into v_current
  from public.number_series ns
  where ns.hospital_id = p_hospital_id
    and ns.key = p_key
    and ns.fy  = v_fy
  for update;                      -- serialises every concurrent allocation

  if not found then
    raise exception 'next_number: counter missing for hospital % key % fy %',
      p_hospital_id, p_key, v_fy;
  end if;

  v_next := v_current + 1;

  update public.number_series ns
     set current_value = v_next
   where ns.hospital_id = p_hospital_id
     and ns.key = p_key
     and ns.fy  = v_fy;

  v_prefix := case p_key
    when 'invoice' then 'INV'
    when 'mrn'     then 'MRN'
    when 'visit'   then 'V'
    when 'token'   then 'T'
  end;

  -- INV/2026-27/00042. Padding is a floor, not a ceiling: number 100000
  -- renders in full rather than being truncated.
  -- If a hospital ever needs its own format, this is the one place to read
  -- hospitals.settings instead.
  return v_prefix || '/' || v_fy || '/' || lpad(v_next::text, 5, '0');
end;
$$;

comment on function public.next_number(uuid, public.number_key) is
  'Allocates the next number for a hospital, key and financial year. Only writer of number_series. Call inside the transaction that consumes the number.';

revoke execute on function public.next_number(uuid, public.number_key) from public, anon;
grant execute on function public.next_number(uuid, public.number_key) to authenticated;

grant execute on function public.financial_year(timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Phase 1 note: queue tokens reset per financial year here, like every other
-- key. A queue token realistically resets per DAY. When create_visit lands,
-- either give number_series a period column or keep tokens out of it entirely.
-- Flagged, not fixed -- changing number_series shape is a schema decision.
-- -----------------------------------------------------------------------------

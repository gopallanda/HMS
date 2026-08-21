-- =============================================================================
-- 20260818090100_jwt_helpers_and_rls.sql
-- JWT claim readers + RLS on every Phase 0 table.
--
-- CLAUDE.md 5:
--   * hospital_id and role are read from JWT claims, NEVER from a subquery
--     inside a policy. A subquery would re-read memberships on every row and
--     would itself be subject to RLS.
--   * policies are a COARSE safety net. Fine-grained permission logic lives in
--     server code and RPCs, not in dozens of policies.
--   * RLS is enabled on every table. No table ships without policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- claim readers
--
-- STABLE so the planner evaluates them once per statement instead of per row.
-- No table access at all, so they cannot recurse into RLS.
-- -----------------------------------------------------------------------------
create or replace function public.app_hospital_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    auth.jwt() -> 'app_metadata' ->> 'hospital_id',
    ''
  )::uuid;
$$;

comment on function public.app_hospital_id() is
  'Active hospital_id from the JWT app_metadata, injected by custom_access_token_hook. Null when the user has no active membership.';

create or replace function public.app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select nullif(
    auth.jwt() -> 'app_metadata' ->> 'role',
    ''
  )::public.app_role;
$$;

comment on function public.app_role() is
  'Role of the caller in the active hospital, from the JWT app_metadata.';

-- has_role('admin', 'super_admin') -- readable role checks inside policies.
create or replace function public.has_role(variadic p_roles public.app_role[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.app_role() = any(p_roles);
$$;

-- Admins of the current hospital. Most write policies reduce to this.
create or replace function public.is_hospital_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.has_role('admin', 'super_admin');
$$;

grant execute on function public.app_hospital_id()   to authenticated;
grant execute on function public.app_role()          to authenticated;
grant execute on function public.has_role(variadic public.app_role[]) to authenticated;
grant execute on function public.is_hospital_admin() to authenticated;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.hospitals     enable row level security;
alter table public.memberships   enable row level security;
alter table public.departments   enable row level security;
alter table public.staff         enable row level security;
alter table public.number_series enable row level security;
alter table public.audit_log     enable row level security;

-- Nothing below grants DELETE to anyone. Nothing in this app hard-deletes a
-- row (CLAUDE.md 3.5) -- soft delete or a status column instead. With RLS on
-- and no delete policy, a delete from an app client matches zero rows.

-- -----------------------------------------------------------------------------
-- hospitals -- the tenant root compares id, not hospital_id
-- -----------------------------------------------------------------------------
create policy hospitals_select_own on public.hospitals
  for select to authenticated
  using (id = public.app_hospital_id());

-- Branding lives here, so admins may update their own hospital row.
-- Creating a hospital is a provisioning action: service role only, no policy.
create policy hospitals_update_admin on public.hospitals
  for update to authenticated
  using (id = public.app_hospital_id() and public.is_hospital_admin())
  with check (id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- memberships
--
-- Two select policies (permissive, so they OR together):
--   1. you can always see your own memberships -- needed for a hospital
--      switcher before any hospital is active.
--   2. admins see everyone in the active hospital.
-- -----------------------------------------------------------------------------
create policy memberships_select_self on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy memberships_select_admin on public.memberships
  for select to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy memberships_insert_admin on public.memberships
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy memberships_update_admin on public.memberships
  for update to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin())
  with check (hospital_id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- departments -- everyone in the hospital reads, admins write
-- -----------------------------------------------------------------------------
create policy departments_select_tenant on public.departments
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy departments_insert_admin on public.departments
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy departments_update_admin on public.departments
  for update to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin())
  with check (hospital_id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- staff -- front desk needs the doctor list, so all members read
-- -----------------------------------------------------------------------------
create policy staff_select_tenant on public.staff
  for select to authenticated
  using (hospital_id = public.app_hospital_id());

create policy staff_insert_admin on public.staff
  for insert to authenticated
  with check (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

create policy staff_update_admin on public.staff
  for update to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin())
  with check (hospital_id = public.app_hospital_id());

-- -----------------------------------------------------------------------------
-- number_series -- readable for display, never writable from the app.
-- next_number() is SECURITY DEFINER and bypasses these policies by design;
-- it is the only writer. A direct update from a client would corrupt
-- invoice numbering, so no insert/update policy exists at all.
-- -----------------------------------------------------------------------------
create policy number_series_select_admin on public.number_series
  for select to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

-- -----------------------------------------------------------------------------
-- audit_log -- admins read their own hospital. No insert policy: rows arrive
-- only via the SECURITY DEFINER trigger. Append only, never updated.
-- -----------------------------------------------------------------------------
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

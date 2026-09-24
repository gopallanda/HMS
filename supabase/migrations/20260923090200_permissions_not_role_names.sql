-- =============================================================================
-- 20260923090200_permissions_not_role_names.sql
-- The database stops guarding on membership role names.
--
-- WHAT WAS WRONG
--
-- `CLAUDE.md` 3.6 says it twice: "Roles are data, permissions are code" and
-- "Guard on permissions, not on role names -- admins can create custom roles,
-- so a hardcoded switch on role strings locks every custom role out of
-- everything." The APP does that. The database did not, and the two disagreed
-- in a way nothing reported.
--
-- The chain: `saveRole` creates a custom role and deliberately leaves
-- `roles.legacy_role` at its inert `'nurse'` default; `provisionStaffAccount`
-- copies that into `memberships.role`; the access token hook puts it on the JWT;
-- `app_role()` and `has_role()` read it. So EVERY custom role a hospital invents
-- is a `nurse` as far as Postgres is concerned, whatever its permissions say.
--
-- The result was wrong in both directions at once.
--
--   REFUSED WHAT IT WAS GRANTED. A hospital creates "Billing executive", ticks
--   billing.read and billing.collect, assigns somebody to it. The nav shows the
--   screen, the proxy lets them through, requirePermission() passes -- and then
--   `invoices_select_billing` returns nothing and `assert_billing()` raises
--   "Only billing staff can raise invoices and take payments." A permission
--   that grants nothing reads as a broken product, and the failure is silent:
--   an empty table looks like a hospital with no invoices in it.
--
--   ALLOWED WHAT IT WAS NOT. `consultations_select_clinical` and
--   `assert_clinical()` both name `nurse`, so every custom role -- including one
--   created for housekeeping or for a store keeper -- satisfied the database's
--   clinical check. Only the app was stopping them. The coarse net was upside
--   down: it refused the money roles and admitted everybody to the notes.
--
-- WHAT THIS DOES
--
-- `has_permission()` already exists (20260908090000) and already argued this
-- exact case for `reports.integrity`: "Guarding this report on
-- is_hospital_admin() would have reproduced exactly that bug." This migration
-- finishes the job for every other role-name check, so the coarse net asks the
-- same question the app asks.
--
-- SAFETY PROPERTY, and it is the reason this is one migration rather than five:
-- `public.is_hospital_admin()` is kept as an OR beside every new permission
-- test, so an admin or a Manager keeps everything they had whatever their
-- permissions say.
--
-- TWO PLACES DO NARROW, and both are deliberate:
--
--   1. The clinical checks. A custom role used to satisfy has_role('nurse') on
--      its legacy default and could read every consultation in the hospital.
--      Only the app was refusing it; now the database does too.
--   2. A membership with NO staff record, for any role but admin and
--      super_admin. Permissions resolve through staff -> roles ->
--      role_permissions, so a `front_desk` claim with no staff row behind it now
--      holds nothing where it used to pass on the name alone. That is the same
--      answer lib/rbac/resolve.ts gives, and provisioning cannot produce the
--      state: provisionStaffAccount writes the staff row before the membership,
--      and provision_hospital gives a founder both. It is reachable only by
--      writing a membership by hand.
--
-- So nothing a real user can do today stops working, and two things a custom
-- role should never have been able to do stop working.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
--   * `create_visit`'s `v_doctor.role <> 'doctor'` check, and therefore the fact
--     that a custom role can never be a visit's doctor. That needs a flag on
--     `public.roles` saying a role consults, which `CLAUDE.md` 3.6 and
--     lib/schemas/staff.ts both defer ("Block 4 gives that its own flag"). It is
--     a feature, not this bug: a hospital that wants a "Senior Consultant" role
--     is asking for something the schema cannot yet say.
--   * The `has_role('doctor')` OWNERSHIP checks in save_consultation,
--     set_visit_status and the prescription path ("if the caller is a doctor,
--     the visit must be theirs"). Those are not capability checks and the right
--     predicate for them is the same missing flag -- and they are vacuous for a
--     custom role anyway, since a custom role cannot be a visit's doctor.
--   * `memberships`, `number_series` and `audit_log` policies. No permission key
--     claims those tables: the first is platform bookkeeping written by the
--     service role, and the other two are raw reads that `reports.view` and
--     `reports.integrity` reach through SECURITY DEFINER functions instead.
-- =============================================================================

-- =============================================================================
-- 0. has_permission(): realign with lib/rbac/resolve.ts
--
-- Its third branch granted everything to an `is_hospital_admin()` login with no
-- staff record, mirroring what fallbackAccess() did at the time. fallbackAccess
-- was narrowed to super_admin earlier today, for the reason resolveAccess had
-- always given: the seeded Manager role carries legacy_role 'admin', so treating
-- `admin` as an override hands every manager settings.manage and roles.manage.
--
-- That branch is now redundant rather than merely narrowed -- super_admin is
-- already unconditional in the first branch -- so it goes. This file's own
-- header made the rule: "Two implementations of one rule must agree."
-- =============================================================================
create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- super_admin is the one membership role that overrides the staff role. It
    -- already opens every write policy in the database, so withholding a
    -- permission from it here would be theatre (CLAUDE.md 3.6).
    public.has_role('super_admin')

    or exists (
      select 1
      from public.staff s
      join public.role_permissions rp on rp.role_id = s.role_id
      where s.user_id = (select auth.uid())
        and s.hospital_id = public.app_hospital_id()
        and rp.permission_key = p_key
    );
$$;

comment on function public.has_permission(text) is
  'Whether the caller holds one permission key, by the same rule lib/rbac/resolve.ts applies: the staff role''s role_permissions, overridden by a super_admin membership. An admin login with no staff record holds nothing, matching fallbackAccess() since 2026-09-23.';

-- =============================================================================
-- 1. has_any_permission(), and the three coarse capabilities built on it
--
-- ONE function taking an array rather than several has_permission() calls
-- OR-ed together, because these run inside RLS policies: five calls is five
-- EXISTS subqueries, one call is one index probe against
-- role_permissions(role_id, permission_key). Neither takes a row-dependent
-- argument, so the planner evaluates them once per query rather than per row --
-- which makes this cheaper than the has_role() checks it replaces, since those
-- re-read and re-parse the JWT.
--
-- The three wrappers exist so a policy and the assert that guards the same act
-- cannot drift apart. They are COARSE on purpose: "may this person touch money
-- at all", not "may they void". The precise key is checked by the Server Action
-- (CLAUDE.md 5 -- fine-grained logic in server code and RPCs, RLS as a safety
-- net), and a net that tried to be precise would be a second, competing
-- permission model.
-- =============================================================================
create or replace function public.has_any_permission(p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_role('super_admin')

    or exists (
      select 1
      from public.staff s
      join public.role_permissions rp on rp.role_id = s.role_id
      where s.user_id = (select auth.uid())
        and s.hospital_id = public.app_hospital_id()
        and rp.permission_key = any(p_keys)
    );
$$;

comment on function public.has_any_permission(text[]) is
  'Whether the caller holds ANY of these permission keys. One index probe, for the coarse capability checks in RLS policies and the assert_* gates.';

revoke execute on function public.has_any_permission(text[]) from public, anon;
grant execute on function public.has_any_permission(text[]) to authenticated;

-- Money. Every billing key, including read: a cashier who may only look still
-- has business on the invoices table, and refusing the read is what made a
-- custom billing role render an empty screen.
create or replace function public.can_bill()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.has_any_permission(array[
    'billing.read', 'billing.collect', 'billing.void',
    'billing.discount', 'billing.defer'
  ]);
$$;

-- The register desk: who may put a patient on the board or correct their
-- record. queue.cancel and queue.manage are here because cancel_visit and
-- transfer_visit are guarded by assert_front_desk() and are front-desk acts.
create or replace function public.can_front_desk()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.has_any_permission(array[
    'patients.create', 'patients.update', 'visits.create',
    'queue.manage', 'queue.cancel'
  ]);
$$;

-- The notes. Read as well as write: a nurse takes the vitals before the doctor
-- walks in, and set_visit_status -- the queue button -- is guarded by
-- assert_clinical() too.
create or replace function public.can_clinical()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.has_any_permission(array['consultation.read', 'consultation.write']);
$$;

comment on function public.can_bill() is
  'Coarse: does the caller hold any billing permission. Replaces has_role(cashier, front_desk, ...) so a custom billing role is not refused what it was granted.';
comment on function public.can_front_desk() is
  'Coarse: does the caller hold any register-desk permission. Replaces has_role(front_desk, ...).';
comment on function public.can_clinical() is
  'Coarse: does the caller hold any consultation permission. Replaces has_role(doctor, nurse, ...) -- which every custom role satisfied, because legacy_role defaults to nurse.';

revoke execute on function public.can_bill()       from public, anon;
revoke execute on function public.can_front_desk() from public, anon;
revoke execute on function public.can_clinical()   from public, anon;
grant execute on function public.can_bill()       to authenticated;
grant execute on function public.can_front_desk() to authenticated;
grant execute on function public.can_clinical()   to authenticated;

-- =============================================================================
-- 2. The three assert_* gates
--
-- The `app_role() is null -> return` early exit is kept exactly as it was in all
-- three, and it is load-bearing: a caller with no JWT is the service role, the
-- seed, a migration or the test suite, and has_permission() is false for all of
-- them because there is no auth.uid() to resolve a staff row from. Removing it
-- would break every seeded registration and every test in tests/.
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

  if not (public.is_hospital_admin() or public.can_bill()) then
    raise exception 'You do not have permission to raise invoices or take payments.'
      using errcode = '42501',
            hint = 'An administrator can grant a billing permission at Administration -> Roles.';
  end if;
end;
$$;

comment on function public.assert_billing() is
  'Coarse money gate. Permission-based since 20260923090200: a custom role with billing.collect is no longer refused because its legacy_role says nurse.';

create or replace function public.assert_front_desk()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if public.app_role() is null then
    return;
  end if;

  if not (public.is_hospital_admin() or public.can_front_desk()) then
    raise exception 'You do not have permission to register patients or start visits.'
      using errcode = '42501',
            hint = 'An administrator can grant visits.create at Administration -> Roles.';
  end if;
end;
$$;

comment on function public.assert_front_desk() is
  'Coarse register-desk gate. Permission-based since 20260923090200.';

create or replace function public.assert_clinical()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if public.app_role() is null then
    return;
  end if;

  if not (public.is_hospital_admin() or public.can_clinical()) then
    raise exception 'You do not have permission to record a consultation.'
      using errcode = '42501',
            hint = 'An administrator can grant consultation.write at Administration -> Roles.';
  end if;
end;
$$;

comment on function public.assert_clinical() is
  'Coarse clinical gate. Permission-based since 20260923090200, which also TIGHTENS it: every custom role used to satisfy the old has_role(nurse) test.';

-- =============================================================================
-- 3. The policies
--
-- Each one keeps its tenant comparison and its `with check` exactly as it was,
-- and swaps only the role-name half. is_hospital_admin() stays as an OR so no
-- role that works today narrows.
-- =============================================================================

-- ---- Money -----------------------------------------------------------------
drop policy if exists invoices_select_billing on public.invoices;
create policy invoices_select_billing on public.invoices
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('billing.read'))
  );

drop policy if exists payments_select_billing on public.payments;
create policy payments_select_billing on public.payments
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('billing.read'))
  );

-- ---- The notes -------------------------------------------------------------
drop policy if exists consultations_select_clinical on public.consultations;
create policy consultations_select_clinical on public.consultations
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.can_clinical())
  );

-- ---- Patients and visits ---------------------------------------------------
drop policy if exists patients_update_desk on public.patients;
create policy patients_update_desk on public.patients
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('patients.update'))
  )
  with check (hospital_id = public.app_hospital_id());

-- The old list was front_desk, doctor and nurse: the desk moves people through
-- the queue and the clinical side moves them through a consultation. Both
-- capabilities, not both role names.
drop policy if exists visits_update_desk on public.visits;
create policy visits_update_desk on public.visits
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (
      public.is_hospital_admin()
      or public.can_front_desk()
      or public.can_clinical()
    )
  )
  with check (hospital_id = public.app_hospital_id());

-- ---- Administration --------------------------------------------------------
drop policy if exists hospitals_update_admin on public.hospitals;
create policy hospitals_update_admin on public.hospitals
  for update to authenticated
  using (
    id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('settings.manage'))
  )
  with check (id = public.app_hospital_id());

drop policy if exists departments_insert_admin on public.departments;
create policy departments_insert_admin on public.departments
  for insert to authenticated
  with check (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('departments.manage'))
  );

drop policy if exists departments_update_admin on public.departments;
create policy departments_update_admin on public.departments
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('departments.manage'))
  )
  with check (hospital_id = public.app_hospital_id());

-- staff.create and staff.update are separate keys in lib/rbac/permissions.ts,
-- and the staff action already picks between them by whether the row exists.
drop policy if exists staff_insert_admin on public.staff;
create policy staff_insert_admin on public.staff
  for insert to authenticated
  with check (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('staff.create'))
  );

-- staff.deactivate is here as well as staff.update: deactivating is an UPDATE
-- of is_active, and a hospital that grants only the narrower key still has to
-- be able to perform it.
drop policy if exists staff_update_admin on public.staff;
create policy staff_update_admin on public.staff
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (
      public.is_hospital_admin()
      or public.has_any_permission(array['staff.update', 'staff.deactivate'])
    )
  )
  with check (hospital_id = public.app_hospital_id());

drop policy if exists services_insert_admin on public.services;
create policy services_insert_admin on public.services
  for insert to authenticated
  with check (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('settings.manage'))
  );

drop policy if exists services_update_admin on public.services;
create policy services_update_admin on public.services
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('settings.manage'))
  )
  with check (hospital_id = public.app_hospital_id());

drop policy if exists roles_insert_admin on public.roles;
create policy roles_insert_admin on public.roles
  for insert to authenticated
  with check (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roles.manage'))
  );

drop policy if exists roles_update_admin on public.roles;
create policy roles_update_admin on public.roles
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roles.manage'))
  )
  with check (hospital_id = public.app_hospital_id());

drop policy if exists role_permissions_insert_admin on public.role_permissions;
create policy role_permissions_insert_admin on public.role_permissions
  for insert to authenticated
  with check (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roles.manage'))
  );

drop policy if exists role_permissions_delete_admin on public.role_permissions;
create policy role_permissions_delete_admin on public.role_permissions
  for delete to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roles.manage'))
  );

-- The roster. roster.write, not roster.read: reading is covered by
-- staff_shifts_select_tenant, which is tenant-only and always was.
drop policy if exists staff_shifts_insert_admin on public.staff_shifts;
create policy staff_shifts_insert_admin on public.staff_shifts
  for insert to authenticated
  with check (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roster.write'))
  );

drop policy if exists staff_shifts_update_admin on public.staff_shifts;
create policy staff_shifts_update_admin on public.staff_shifts
  for update to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roster.write'))
  )
  with check (hospital_id = public.app_hospital_id());

-- The one deliberate delete on a record in this schema: clearing a roster cell
-- is how "nothing recorded" is said, and the absence of a row is the only way
-- to say it (CLAUDE.md 3.5).
drop policy if exists staff_shifts_delete_admin on public.staff_shifts;
create policy staff_shifts_delete_admin on public.staff_shifts
  for delete to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('roster.write'))
  );

-- Who has a login. staff.read rather than accounts.provision: the staff LIST
-- shows account state beside every person, and a role that may open that screen
-- but cannot read this table sees a column that is blank for everybody.
drop policy if exists staff_accounts_select_admin on public.staff_accounts;
create policy staff_accounts_select_admin on public.staff_accounts
  for select to authenticated
  using (
    hospital_id = public.app_hospital_id()
    and (public.is_hospital_admin() or public.has_permission('staff.read'))
  );

-- =============================================================================
-- 4. The branding bucket
--
-- Uploading a logo is part of Administration -> Hospital settings, which the app
-- guards with settings.manage. Left on is_hospital_admin(), a custom role could
-- edit every field on that screen and not replace the logo on the invoice --
-- the same half-working screen this migration exists to remove.
--
-- Same DO block, same drop-before-create, and the same insufficient_privilege
-- guard as 20260818110000: on a project where the migration role does not own
-- storage.objects this warns with instructions instead of failing the push.
-- =============================================================================
do $$
begin
  drop policy if exists branding_insert_admin  on storage.objects;
  drop policy if exists branding_update_admin  on storage.objects;
  drop policy if exists branding_delete_admin  on storage.objects;

  execute $p$
    create policy branding_insert_admin on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'branding'
        and (public.is_hospital_admin() or public.has_permission('settings.manage'))
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
  $p$;

  execute $p$
    create policy branding_update_admin on storage.objects
      for update to authenticated
      using (
        bucket_id = 'branding'
        and (public.is_hospital_admin() or public.has_permission('settings.manage'))
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
      with check (
        bucket_id = 'branding'
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
  $p$;

  execute $p$
    create policy branding_delete_admin on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'branding'
        and (public.is_hospital_admin() or public.has_permission('settings.manage'))
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
  $p$;

exception
  when insufficient_privilege then
    raise warning using message =
      'storage: could not update the branding policies on storage.objects. Set them by hand: '
      'Dashboard -> Storage -> branding -> Policies. Insert/update/delete: authenticated, '
      '(public.is_hospital_admin() or public.has_permission(''settings.manage'')) '
      'and (storage.foldername(name))[1] = public.app_hospital_id()::text';
end;
$$;

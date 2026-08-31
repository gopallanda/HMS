-- =============================================================================
-- 20260828090300_my_access.sql
-- my_access() -> jsonb
--
-- Everything the app needs to know about the caller that is not already on the
-- JWT: which staff record is theirs, which role it names, what that role may
-- do, and whether their account is still usable.
--
-- WHY ONE FUNCTION RATHER THAN THREE SELECTS
--
-- This is read on every request -- the proxy needs must_change_password before
-- it can let a page render, and the shell needs the permission set before it
-- can draw a nav. Three round trips per request, including every router
-- prefetch, is the difference between a queue screen that feels instant and
-- one that does not. PostgREST cannot embed role_permissions through staff
-- without a declared relationship, so the join happens here.
--
-- SECURITY DEFINER, and narrowly so: it takes the caller from auth.uid() and
-- the tenant from the JWT claim. There is no parameter, so there is nothing to
-- pass in on somebody else's behalf.
--
-- Returns null when the login has no staff record in the active hospital. That
-- is a real state, not an error: a founder provisioned before staff records
-- existed, or an administrator whose staff row was removed. The caller decides
-- what to do with it (lib/rbac/access.ts falls back to the membership role).
-- =============================================================================

create or replace function public.my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'staff_id',             s.id,
    'staff_name',           s.full_name,
    'role_id',              r.id,
    'role_code',            r.code,
    'role_name',            r.name,
    'role_can_login',       r.can_login,
    'staff_can_login',      s.can_login,
    'permissions',          coalesce(
                              (select jsonb_agg(rp.permission_key order by rp.permission_key)
                                 from public.role_permissions rp
                                where rp.role_id = r.id),
                              '[]'::jsonb
                            ),
    'has_account',          (a.id is not null),
    'account_disabled',     (a.disabled_at is not null),
    'must_change_password', coalesce(a.must_change_password, false),
    'username',             a.username,
    'contact_email',        a.contact_email
  )
  from public.staff s
  join public.roles r
    on r.id = s.role_id
  left join public.staff_accounts a
    on a.staff_id = s.id
  where s.user_id = auth.uid()
    and s.hospital_id = public.app_hospital_id()
  limit 1;
$$;

comment on function public.my_access() is
  'The caller staff record, role, permission keys and account state, in one read. Null when the login has no staff record in the active hospital.';

revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

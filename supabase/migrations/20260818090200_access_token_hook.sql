-- =============================================================================
-- 20260818090200_access_token_hook.sql
-- Custom access token hook: injects hospital_id and role into the JWT.
--
-- WHY: RLS policies read hospital_id and role from the token
-- (CLAUDE.md 3.1). Without this hook every policy would have to subquery
-- memberships once per row, which is both slow and recursive (memberships
-- itself has RLS).
--
-- -----------------------------------------------------------------------------
-- HOW TO ENABLE
--
-- Local (already wired in supabase/config.toml):
--     [auth.hook.custom_access_token]
--     enabled = true
--     uri = "pg-functions://postgres/public/custom_access_token_hook"
--   then: npx supabase db reset
--
-- Hosted project (one manual step per environment -- the SQL alone does
-- nothing until the hook is selected):
--   1. Supabase Dashboard -> Authentication -> Hooks
--   2. "Customize Access Token (JWT) Claims" -> Add hook -> Postgres
--   3. Schema: public   Function: custom_access_token_hook
--   4. Enable, save.
--   5. Sign out and back in. Existing tokens keep the OLD claims until they
--      are refreshed -- claims are baked in at issue time.
--
-- Changing a user's membership does NOT change their live token. Force a
-- refresh (or wait for the next one) before the new role takes effect.
-- -----------------------------------------------------------------------------
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id      uuid;
  v_claims       jsonb;
  v_requested    uuid;
  v_hospital_id  uuid;
  v_role         public.app_role;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := event -> 'claims';

  -- jsonb_set cannot create a missing intermediate object, so make sure
  -- app_metadata exists before writing into it.
  if v_claims -> 'app_metadata' is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb, true);
  end if;

  -- A user may belong to several hospitals. If the client has parked a chosen
  -- hospital in app_metadata (via the admin API), honour it -- but only if it
  -- is a real, active membership. This is the hook a hospital switcher uses.
  begin
    v_requested := nullif(v_claims -> 'app_metadata' ->> 'active_hospital_id', '')::uuid;
  exception when invalid_text_representation then
    v_requested := null;
  end;

  select m.hospital_id, m.role
    into v_hospital_id, v_role
  from public.memberships m
  where m.user_id = v_user_id
    and m.is_active
    and (v_requested is null or m.hospital_id = v_requested)
  order by m.created_at
  limit 1;

  -- Fall back to any active membership if the requested one is gone or was
  -- deactivated, so a stale active_hospital_id cannot lock a user out.
  if v_hospital_id is null and v_requested is not null then
    select m.hospital_id, m.role
      into v_hospital_id, v_role
    from public.memberships m
    where m.user_id = v_user_id
      and m.is_active
    order by m.created_at
    limit 1;
  end if;

  if v_hospital_id is null then
    -- No active membership: emit explicit nulls. app_hospital_id() then
    -- returns null, every policy compares against null, and the user sees
    -- nothing. Fail closed, and visibly.
    v_claims := jsonb_set(v_claims, '{app_metadata,hospital_id}', 'null'::jsonb, true);
    v_claims := jsonb_set(v_claims, '{app_metadata,role}',        'null'::jsonb, true);
  else
    v_claims := jsonb_set(
      v_claims, '{app_metadata,hospital_id}', to_jsonb(v_hospital_id::text), true
    );
    v_claims := jsonb_set(
      v_claims, '{app_metadata,role}', to_jsonb(v_role::text), true
    );
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook. Injects app_metadata.hospital_id and app_metadata.role from the caller active membership. Enable in Dashboard -> Authentication -> Hooks.';

-- -----------------------------------------------------------------------------
-- Grants. The hook runs as supabase_auth_admin, which is NOT a superuser and
-- has no access to the public schema by default.
-- -----------------------------------------------------------------------------
grant usage on schema public to supabase_auth_admin;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- The hook reads memberships. Deliberately NOT security definer: instead give
-- supabase_auth_admin a narrow, explicit read path.
grant select on table public.memberships to supabase_auth_admin;

create policy memberships_select_auth_admin on public.memberships
  as permissive for select to supabase_auth_admin
  using (true);

-- =============================================================================
-- 20260825120000_attach_staff_login.sql
-- attach_staff_login(p_staff_id, p_email, p_role) -> jsonb
--
-- Gives an existing staff record a login: the membership that puts hospital_id
-- and role on their JWT, plus the staff.user_id that links the person to it.
--
-- WHY A FUNCTION:
--   * it reads auth.users to find whether that email already has an account.
--     There is no email filter on the admin API (listUsers pages through every
--     user of every tenant), and scanning all of them on each invite is both
--     slow and a cross-tenant read.
--   * the membership insert and the staff.user_id update belong together. Half
--     of this pair is a person who can sign in but is nobody on the staff list,
--     or a staff row pointing at a login with no access.
--
-- WHAT IT DELIBERATELY DOES NOT DO: create the auth user. That is the caller's
-- job, through the admin API, because only it can send the invitation email.
-- The caller runs this first, gets 'no_such_user', sends the invite, and runs
-- it again -- so this function never has to be trusted with account creation.
-- =============================================================================

create or replace function public.attach_staff_login(
  p_staff_id uuid,
  p_email    text,
  p_role     public.app_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_email       text;
  v_user_id     uuid;
  v_staff       public.staff;
  v_existing    text;
begin
  v_hospital_id := public.app_hospital_id();

  -- SECURITY DEFINER means RLS is not behind this. The tenant and role checks
  -- that the policies would have made have to be made here, explicitly.
  if v_hospital_id is null or not public.is_hospital_admin() then
    raise exception 'Only an administrator can issue a login.'
      using errcode = '42501';
  end if;

  -- super_admin is for the people who run the PLATFORM. A hospital admin must
  -- not be able to mint one, the same reason provision_hospital never does
  -- (20260825090000).
  if p_role = 'super_admin' then
    raise exception 'A hospital administrator cannot grant super_admin.'
      using errcode = '42501';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'An email address is required to issue a login.';
  end if;

  select s.* into v_staff
  from public.staff s
  where s.id = p_staff_id
    and s.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That staff record is not in this hospital.'
      using errcode = '42501';
  end if;

  if v_staff.user_id is not null then
    raise exception '% already has a login.', v_staff.full_name;
  end if;

  if not v_staff.is_active then
    raise exception 'Reactivate % before issuing a login.', v_staff.full_name;
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email;

  -- Not an error: the caller is expected to answer this by sending an
  -- invitation and calling again.
  if v_user_id is null then
    return jsonb_build_object('status', 'no_such_user');
  end if;

  -- That login may already be somebody else here. The partial unique index on
  -- (hospital_id, user_id) would catch it, but by name is a better answer than
  -- by constraint.
  select s.full_name into v_existing
  from public.staff s
  where s.hospital_id = v_hospital_id
    and s.user_id = v_user_id
    and s.id <> p_staff_id;

  if found then
    raise exception 'That email already signs in as %.', v_existing;
  end if;

  -- A user may belong to several hospitals (CLAUDE.md 4), so this is an upsert,
  -- not an insert: re-inviting somebody whose membership was deactivated
  -- restores it rather than failing on the unique constraint.
  insert into public.memberships (user_id, hospital_id, role, is_active)
  values (v_user_id, v_hospital_id, p_role, true)
  on conflict (user_id, hospital_id) do update
    set role = excluded.role,
        is_active = true;

  update public.staff
     set user_id = v_user_id
   where id = p_staff_id
     and hospital_id = v_hospital_id;

  return jsonb_build_object('status', 'attached', 'user_id', v_user_id);
end;
$$;

comment on function public.attach_staff_login(uuid, text, public.app_role) is
  'Links an auth user to a staff record and gives them a membership in the caller hospital. Returns {"status":"no_such_user"} when the email has no account yet, so the caller can send an invitation and call again. Admin only; cannot grant super_admin.';

revoke execute on function public.attach_staff_login(uuid, text, public.app_role)
  from public, anon;
grant execute on function public.attach_staff_login(uuid, text, public.app_role)
  to authenticated;

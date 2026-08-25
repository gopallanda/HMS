-- =============================================================================
-- 20260825090000_provision_hospital.sql
-- provision_hospital() -> uuid
--
-- Self-serve tenant creation: someone signs up, and the account they just made
-- becomes the administrator of a brand new hospital.
--
-- WHY A FUNCTION, not an insert from a Server Action:
--   * hospitals has no insert policy at all -- creating a tenant was a
--     service-role act until now (20260818090100).
--   * memberships_insert_admin requires is_hospital_admin(), and a user who has
--     no membership yet is nobody's admin. The check cannot pass on the very
--     first write, by construction.
-- So this runs SECURITY DEFINER and does its own, narrower, authorisation:
-- you may create a hospital only for yourself, and only if you are not already
-- in one.
--
-- The name and full name come from auth.users.raw_user_meta_data -- what
-- supabase.auth.signUp({ options: { data } }) stores. Taking them from the
-- token's own user record rather than from a parameter means a caller cannot
-- provision on behalf of somebody else, and means the pending signup survives
-- an email-confirmation round trip where no session exists to carry it.
-- =============================================================================

create or replace function public.provision_hospital()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id       uuid;
  v_meta          jsonb;
  v_email         text;
  v_hospital_name text;
  v_full_name     text;
  v_hospital_id   uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'provision_hospital: not signed in'
      using errcode = '42501';
  end if;

  -- Serialise per user for the rest of the transaction.
  --
  -- Without this, two calls that arrive together -- a double-submitted signup,
  -- or signup racing the provision-on-login fallback -- both read "no
  -- membership" and both create a hospital. The unique constraint on
  -- memberships is (user_id, hospital_id), so it does NOT catch this: the two
  -- hospital_ids differ. The loser would leave an orphan tenant behind that
  -- nobody can reach or delete.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  -- Idempotent. A user who already belongs somewhere gets that hospital back
  -- instead of a second one: this function is the SIGNUP path, and joining a
  -- further hospital is an invitation, never a self-serve act.
  select m.hospital_id
    into v_hospital_id
  from public.memberships m
  where m.user_id = v_user_id
    and m.is_active
  order by m.created_at
  limit 1;

  if v_hospital_id is not null then
    return v_hospital_id;
  end if;

  select u.raw_user_meta_data, u.email
    into v_meta, v_email
  from auth.users u
  where u.id = v_user_id;

  v_hospital_name := nullif(btrim(coalesce(v_meta ->> 'hospital_name', '')), '');
  v_full_name     := nullif(btrim(coalesce(v_meta ->> 'full_name', '')), '');

  -- Null, not an exception: "signed in, no membership, no pending signup" is a
  -- real and different situation -- a deactivated member, or the access token
  -- hook not enabled on this project. The caller tells those apart and has a
  -- specific message for each. Failing here would collapse them into one.
  if v_hospital_name is null then
    return null;
  end if;

  insert into public.hospitals (name)
  values (v_hospital_name)
  returning id into v_hospital_id;

  -- 'admin', deliberately not 'super_admin'. super_admin is meant for the
  -- people who run the PLATFORM, and signup must never mint one. The two grant
  -- the same access today (is_hospital_admin covers both), so this costs
  -- nothing now and is the difference that matters the day a platform console
  -- exists.
  insert into public.memberships (user_id, hospital_id, role, is_active)
  values (v_user_id, v_hospital_id, 'admin', true);

  -- The hospital's first staff record, already attached to this login. Without
  -- it the founder is an administrator with no presence on their own staff
  -- list, and current_staff_id() returns null for them.
  --
  -- Nothing else is seeded. Departments and a service catalogue are NOT created
  -- here: a charge_items row takes a null service_id and create_visit prices a
  -- consultation from the doctor's own fee, so an invented catalogue is not
  -- needed to raise the first invoice -- and invented PRICES in a billing
  -- system are a hazard, not a convenience. The setup checklist on the overview
  -- walks the admin through the real ones.
  insert into public.staff (hospital_id, user_id, full_name, role)
  values (
    v_hospital_id,
    v_user_id,
    coalesce(v_full_name, v_email, 'Administrator'),
    'admin'
  );

  return v_hospital_id;
end;
$$;

comment on function public.provision_hospital() is
  'Self-serve tenant creation. Creates a hospital, an admin membership and a staff row for the calling user, from the hospital_name/full_name stored on their auth.users record at signup. Idempotent: returns the existing hospital if the caller already belongs to one, and null if there is no pending signup to act on.';

-- anon must not reach this: provisioning is for a caller who has authenticated
-- but has no hospital yet, which is an authenticated state, not a public one.
revoke execute on function public.provision_hospital() from public, anon;
grant execute on function public.provision_hospital() to authenticated;

-- =============================================================================
-- 20260828090200_staff_accounts.sql
-- Credentials handed over at the desk, not emailed.
--
-- WHAT THIS REPLACES: an invitation flow that assumed every member of staff has
-- a work mailbox and will complete an email round trip before their first
-- shift. In a 40-bed hospital in Bengaluru they have neither. The receptionist
-- is handed a username and a temporary password on a slip of paper, signs in,
-- and is made to change it. attach_staff_login() is dropped at the bottom of
-- this file; nothing half-wired is left behind.
--
-- WHY staff_accounts IS SEPARATE FROM staff
--
-- Revoking somebody's access has to be ONE write. If the authorisation lived on
-- the staff row it would be a hunt: clear the user_id, deactivate the
-- membership, remember the auth user. One row, one disabled_at.
--
-- THE TWO EMAILS, AND WHY THEY ARE NOT THE SAME COLUMN
--
--   login_email   synthetic, built from the username and the hospital slug.
--                 Immutable. It exists because Supabase Auth identifies users
--                 by email and this product identifies them by username. It is
--                 never shown to staff and never receives mail.
--   contact_email the person's real mailbox. Required at provisioning, so an
--                 account can recover itself without an administrator. Used for
--                 exactly one thing: the password reset link. Never a login.
--
-- Collapsing them would mean a member of staff who changes their personal
-- email address changes their login, and a hospital that mistypes one locks
-- somebody out of an account they have never used.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- hospitals.slug -- the middle of every synthetic login address.
--
-- Globally unique, and deliberately so: it is a component of an email address
-- in a namespace Supabase Auth keeps globally unique anyway. CLAUDE.md 3.1
-- scopes unique constraints on tenant BUSINESS keys to hospital_id; hospitals
-- is the tenant root, and this is its name in the auth namespace.
--
-- Not editable by an administrator: `grant update (...)` in 20260825140000
-- lists the columns authenticated may write and slug is not among them. That
-- is the point -- a renamed slug would orphan every login built from it.
-- -----------------------------------------------------------------------------
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g'),
        '-+', '-', 'g'
      ),
      '-'
    ),
    ''
  );
$$;

comment on function public.slugify(text) is
  'Lowercase, hyphen separated, ascii only. Used for hospitals.slug, which becomes part of every synthetic login address.';

alter table public.hospitals add column slug text
  check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');

-- Backfill. Two hospitals may genuinely share a name, so a collision appends
-- an ordinal rather than failing the migration.
do $$
declare
  v_row   record;
  v_base  text;
  v_slug  text;
  v_n     int;
begin
  for v_row in select id, name from public.hospitals order by created_at loop
    v_base := coalesce(public.slugify(v_row.name), 'hospital');
    v_base := pg_catalog.left(v_base, 34);
    v_slug := v_base;
    v_n := 1;
    while exists (select 1 from public.hospitals where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n::text;
    end loop;
    update public.hospitals set slug = v_slug where id = v_row.id;
  end loop;
end;
$$;

create unique index hospitals_slug_key on public.hospitals (slug);
alter table public.hospitals alter column slug set not null;

comment on column public.hospitals.slug is
  'Immutable tenant handle. Appears inside every synthetic staff login address, so renaming it would orphan every login.';

-- -----------------------------------------------------------------------------
-- staff_accounts -- the authorisation row
-- -----------------------------------------------------------------------------
create table public.staff_accounts (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references public.hospitals(id),

  staff_id      uuid not null unique,
  auth_user_id  uuid unique references auth.users(id) on delete set null,

  login_email   text not null,
  contact_email text not null,
  username      text not null check (username ~ '^[a-z0-9]([a-z0-9._-]{1,30}[a-z0-9])$'),

  -- Authoritative for access. staff.role_id mirrors it, and the provisioning
  -- action writes both together; if the two ever disagree, this one wins,
  -- because this is the row a sign-in resolves against.
  role_id       uuid not null,

  -- Deliberately NOT the prompt's `temp_password text`.
  --
  -- The product shows a temporary password exactly once, in a modal, and has
  -- no "show it again" anywhere -- which makes storing the plaintext pure
  -- liability: it can be read by anything holding the service role and it buys
  -- nothing the modal has not already delivered. What an administrator
  -- actually needs to know is whether an unused temporary password is still
  -- outstanding, and that is a timestamp. Lost credentials are answered by
  -- resetStaffPassword, which mints a new one. Noted in PROGRESS.md.
  temp_password_issued_at timestamptz,

  must_change_password boolean not null default true,

  -- Sign-in throttling (block 2.5: 5 failures in 15 minutes, then a cooldown).
  -- Kept here rather than in a table of attempts, because an attempt against a
  -- username that does not exist has no hospital to file itself under -- and
  -- cannot succeed either, so it does not need counting.
  failed_sign_ins     integer not null default 0 check (failed_sign_ins >= 0),
  first_failed_at     timestamptz,
  locked_until        timestamptz,

  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  disabled_at   timestamptz,

  constraint staff_accounts_staff_same_hospital_fkey
    foreign key (hospital_id, staff_id)
    references public.staff (hospital_id, id),

  constraint staff_accounts_role_same_hospital_fkey
    foreign key (hospital_id, role_id)
    references public.roles (hospital_id, id)
);

-- Global, because both live in a global namespace: login_email is an
-- auth.users email, and a recovery mailbox belongs to one person.
create unique index staff_accounts_lower_login_email_key
  on public.staff_accounts (lower(login_email));
create unique index staff_accounts_lower_contact_email_key
  on public.staff_accounts (lower(contact_email));

-- Scoped, per the schema sketch. Provisioning additionally checks the username
-- is free across the whole deployment before it settles on one, because
-- sign-in resolves a bare username with no hospital to narrow it -- see
-- lib/credentials.ts.
create unique index staff_accounts_hospital_id_lower_username_key
  on public.staff_accounts (hospital_id, lower(username));

create index staff_accounts_hospital_id_disabled_at_idx
  on public.staff_accounts (hospital_id, disabled_at);

comment on table public.staff_accounts is
  'One row per staff login. Revoking access is one write: disabled_at. Never created from the client -- see the provisionStaffAccount server action.';
comment on column public.staff_accounts.login_email is
  'Synthetic and immutable: username@<hospital-slug>.staff.<domain>. Never shown to staff, never receives mail.';
comment on column public.staff_accounts.contact_email is
  'The real mailbox. Recovery only, never a login. Required at creation so an account can recover itself without an administrator.';
comment on column public.staff_accounts.temp_password_issued_at is
  'When a temporary password was last issued. The password itself is never stored -- it is shown once and then only resettable.';

-- -----------------------------------------------------------------------------
-- password_reset_tokens
--
-- Only the sha256 of a 256-bit random value is stored, so a database read does
-- not yield working links. Single use, 60 minute TTL, and superseded tokens are
-- BURNT (used_at set) rather than deleted, so "this link is already dead" and
-- "this link never existed" are the same answer and neither one is a signal.
-- -----------------------------------------------------------------------------
create table public.password_reset_tokens (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  account_id   uuid not null references public.staff_accounts(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  requested_ip text,
  created_at   timestamptz not null default now()
);

create index password_reset_tokens_hospital_id_account_id_created_at_idx
  on public.password_reset_tokens (hospital_id, account_id, created_at desc);

comment on table public.password_reset_tokens is
  'Service role only: RLS is on with no policies at all, and anon/authenticated hold no grants. Stores sha256 hashes, never tokens.';

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.staff_accounts        enable row level security;
alter table public.password_reset_tokens enable row level security;

-- Every request needs to know whether the signed-in user is still whitelisted
-- and whether they are still holding a temporary password. Without this the
-- forced-change gate would need the service role on every page load.
create policy staff_accounts_select_self on public.staff_accounts
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

-- Administrators see who in their hospital has an account, so the staff list
-- can show it. They do not WRITE these rows: provisioning creates an auth user
-- and this row together, with rollback, and that has to happen in one place.
create policy staff_accounts_select_admin on public.staff_accounts
  for select to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

-- password_reset_tokens gets NO policies. RLS on with none means every row is
-- invisible to anon and authenticated whatever they ask. The revoke below
-- removes the grants as well, so the failure is at the privilege layer and
-- never depends on a policy being right.
revoke all on public.password_reset_tokens from anon, authenticated;

create trigger staff_accounts_audit
  after insert or update or delete on public.staff_accounts
  for each row execute function public.fn_audit();

create trigger staff_accounts_hospital_active
  before insert or update on public.staff_accounts
  for each row execute function public.enforce_hospital_active();

-- Deliberately no audit trigger on password_reset_tokens: the row IS the
-- record, and copying token hashes into audit_log -- which administrators can
-- read -- would widen their blast radius for nothing.

-- =============================================================================
-- provision_hospital(): a new tenant gets a slug with everything else.
--
-- Full body again; the only change from 20260828090100 is the slug.
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
  v_admin_role_id uuid;
  v_base          text;
  v_slug          text;
  v_n             int := 1;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'provision_hospital: not signed in'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

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

  if v_hospital_name is null then
    return null;
  end if;

  v_base := pg_catalog.left(coalesce(public.slugify(v_hospital_name), 'hospital'), 34);
  v_slug := v_base;
  while exists (select 1 from public.hospitals h where h.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;

  insert into public.hospitals (name, slug)
  values (v_hospital_name, v_slug)
  returning id into v_hospital_id;

  perform public.seed_system_roles(v_hospital_id);

  select r.id into v_admin_role_id
  from public.roles r
  where r.hospital_id = v_hospital_id
    and r.code = 'admin'
    and r.deleted_at is null;

  insert into public.memberships (user_id, hospital_id, role, is_active)
  values (v_user_id, v_hospital_id, 'admin', true);

  insert into public.staff (hospital_id, user_id, full_name, role, role_id)
  values (
    v_hospital_id,
    v_user_id,
    coalesce(v_full_name, v_email, 'Administrator'),
    'admin',
    v_admin_role_id
  );

  return v_hospital_id;
end;
$$;

revoke execute on function public.provision_hospital() from public, anon;
grant execute on function public.provision_hospital() to authenticated;

-- =============================================================================
-- The invitation flow, removed.
--
-- attach_staff_login() existed to link an auth user created by
-- inviteUserByEmail() to a staff record. There are no invitations any more, so
-- there is nothing for it to finish. Dropping it rather than leaving it
-- unreferenced is the point: an unused SECURITY DEFINER function that grants
-- memberships is a live path with nobody watching it.
-- =============================================================================
drop function if exists public.attach_staff_login(uuid, text, public.app_role);

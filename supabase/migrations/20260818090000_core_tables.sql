-- =============================================================================
-- 20260818090000_core_tables.sql
-- Phase 0 core: hospitals, memberships, departments, staff, number_series,
-- audit_log.
--
-- Rules enforced here (CLAUDE.md 3.1):
--   * every tenant table carries hospital_id not null references hospitals(id)
--   * every unique constraint on a business key is scoped to hospital_id
--   * every composite index leads with hospital_id
--
-- Structural note: hospitals is the tenant root. Its own primary key IS the
-- hospital_id, so it does not carry a self-referencing hospital_id column.
-- Its RLS policy compares id to the JWT claim instead. This is the single
-- exception, and it is structural, not a shortcut.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- enums (lowercase snake_case values, per CLAUDE.md 4)
-- -----------------------------------------------------------------------------
create type public.app_role as enum (
  'super_admin',
  'admin',
  'doctor',
  'front_desk',
  'cashier',
  'pharmacist',
  'lab_tech',
  'nurse'
);

-- Phase 1 keys are declared now so number_series does not need an enum change
-- mid-phase. visit and token are unused until create_visit lands.
create type public.number_key as enum (
  'invoice',
  'mrn',
  'visit',
  'token'
);

create type public.audit_action as enum (
  'insert',
  'update',
  'delete'
);

-- -----------------------------------------------------------------------------
-- hospitals -- tenant root
-- -----------------------------------------------------------------------------
create table public.hospitals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  address     text,
  phone       text,
  gstin       text,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.hospitals is
  'Tenant root. hospitals.id is the hospital_id every other table references.';
comment on column public.hospitals.settings is
  'Per-hospital app settings (print defaults, number formats). Never schema-critical.';

-- -----------------------------------------------------------------------------
-- memberships -- which auth user belongs to which hospital, in what role.
-- A user may belong to multiple hospitals; the JWT carries the active one.
-- -----------------------------------------------------------------------------
create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  hospital_id  uuid not null references public.hospitals(id),
  role         public.app_role not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint memberships_user_hospital_key unique (user_id, hospital_id)
);

create index memberships_hospital_id_user_id_idx
  on public.memberships (hospital_id, user_id);
create index memberships_user_id_is_active_idx
  on public.memberships (user_id, is_active);

comment on table public.memberships is
  'Source of truth for the hospital_id and role injected into the JWT by the custom access token hook.';

-- -----------------------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------------------
create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  name         text not null,
  code         text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  -- scoped, never global: two hospitals may both use the code ORTHO
  constraint departments_hospital_id_code_key unique (hospital_id, code),
  -- lets child tables carry a composite FK that pins the tenant (see staff)
  constraint departments_hospital_id_id_key unique (hospital_id, id)
);

create unique index departments_hospital_id_lower_name_key
  on public.departments (hospital_id, lower(name));
create index departments_hospital_id_is_active_idx
  on public.departments (hospital_id, is_active);

-- -----------------------------------------------------------------------------
-- staff -- a person who works here. user_id null = no login yet.
-- -----------------------------------------------------------------------------
create table public.staff (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references public.hospitals(id),
  user_id           uuid references auth.users(id) on delete set null,
  full_name         text not null,
  role              public.app_role not null,
  department_id     uuid,
  phone             text,
  reg_no            text,
  consultation_fee  numeric(12,2) not null default 0 check (consultation_fee >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  -- composite FK: a staff row can only point at a department in its OWN
  -- hospital. Cheap now, a data-repair script later.
  constraint staff_department_same_hospital_fkey
    foreign key (hospital_id, department_id)
    references public.departments (hospital_id, id)
);

-- one staff record per login per hospital; multiple login-less records are fine
create unique index staff_hospital_id_user_id_key
  on public.staff (hospital_id, user_id)
  where user_id is not null;

create index staff_hospital_id_department_id_idx
  on public.staff (hospital_id, department_id);
create index staff_hospital_id_role_is_active_idx
  on public.staff (hospital_id, role, is_active);

comment on column public.staff.consultation_fee is
  'numeric(12,2) -- money is never float (CLAUDE.md 3.2). Seeds the consultation charge_item in Phase 1.';

-- -----------------------------------------------------------------------------
-- number_series -- per hospital, per key, per financial year.
-- Never a Postgres sequence: sequences are global and leak gaps on rollback.
-- Written only by public.next_number() (see 20260818090400).
-- -----------------------------------------------------------------------------
create table public.number_series (
  hospital_id    uuid not null references public.hospitals(id),
  key            public.number_key not null,
  fy             text not null check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  current_value  bigint not null default 0 check (current_value >= 0),
  primary key (hospital_id, key, fy)
);

comment on table public.number_series is
  'Counter per hospital, key and financial year. fy format: 2026-27 (Indian FY, Apr 1 to Mar 31).';

-- -----------------------------------------------------------------------------
-- audit_log -- append only, written by trigger (see 20260818090300)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id),
  table_name   text not null,
  record_id    uuid not null,
  action       public.audit_action not null,
  actor_id     uuid,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);

create index audit_log_hospital_id_at_idx
  on public.audit_log (hospital_id, at desc);
create index audit_log_hospital_id_table_name_record_id_idx
  on public.audit_log (hospital_id, table_name, record_id);

comment on column public.audit_log.actor_id is
  'auth.uid() at write time. Null for system or service-role writes such as seeds.';

# HMS Codebase Audit

*A file-by-file account of what's actually built in the Hospital Management System repository — schema, RPCs, routes, auth, and the gap between the README's claims and the code underneath them. Compiled by reading every migration, RPC, route, component, and config file in `d:/professional/HMS` against its git history and `CLAUDE.md`'s stated rules. Reflects the working tree as of 2026-08-25.*

**At a glance:** Phase 1 complete & working · 14 migrations, RLS on 13/13 tables · 1 test file (money concurrency only) · 0 CI/Docker/deploy config · `.env` never committed (clean)

---

## 1. Project Overview

HMS is a multi-tenant hospital/clinic management system for small Indian hospitals (20–100 beds), built for one hospital first and sold as SaaS later. It is a single Next.js repository, not a monorepo — there is no separate backend service; Postgres functions (RPCs) on a hosted Supabase project *are* the backend.

### What it solves

Front desk registration, OPD queueing, billing/invoicing with GST-aware line items, and a minimal doctor consultation workflow for small Indian clinics — the kind of shop that currently runs on a paper register and a WhatsApp group. The schema and RPCs are opinionated toward two domain facts that shape almost every design decision in the codebase: hospital billing in India is largely GST-exempt while pharmacy sales are taxed (so tax is per-line, never per-invoice), and patients often share a phone number within a family (so duplicate-phone is a soft prompt, not a hard block).

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.1 (App Router), React 19.2.8, TypeScript 5.9 strict |
| Styling | Tailwind CSS v4 + shadcn/ui (12 primitives installed, a deliberately minimal set) |
| Database / Auth / Storage / Realtime | Supabase, hosted only, region `ap-south-1` (Mumbai) — no local Docker stack anywhere |
| Validation | Zod 4, one schema file per entity, imported by both client and server |
| Client cache | TanStack Query — scoped narrowly to fast reads (patient search, pending charges); all mutations go through Server Actions |
| Migrations | Supabase CLI via a custom Node wrapper (`scripts/db.mjs`), never the dashboard |
| Testing | Node's built-in test runner (`node --test`), against the real hosted DB — no mocks, no Docker |

### Repository shape

One repository, no workspaces/monorepo tooling. Route groups separate the shell into distinct layout contexts:

```
app/
  (app)/            authenticated shell — sidebar, session gate
    admin/           settings · departments · staff
    front-desk/      register · queue
    billing/         collect · invoices · day-close
    doctor/          queue · visit/[id]
  (auth)/            login · signup · set-password · auth/confirm
  (print)/           print/invoice/[id]  (thermal + A4 templates)
  api/               reserved, currently empty (.gitkeep only)
components/
  ui/                12 shadcn primitives
  shared/             field, form-message, money-input, page-header,
                       print-layout, submit-button
  shell/              app-sidebar, user-menu, lifecycle-banner,
                       access-denied, theme-provider, query-provider
lib/
  auth/  supabase/  rpc/  schemas/  utils/
supabase/
  migrations/         14 timestamped SQL files
  seed.sql
tests/
  collect-payment-concurrency.test.mjs
```

Status, per the README and confirmed against the code: **Phase 1 in progress** — admin, front desk, billing, and a minimal doctor module are built and functioning end to end. Lab, pharmacy, and IPD (Phases 2–3) are not merely unfinished; they are *absent* from the codebase entirely — no tables, no routes, no nav entries — which is exactly what `CLAUDE.md`'s phase-discipline rule asks for.

---

## 2. Database & Data Model

Postgres on Supabase. 13 base tables, all multi-tenant via `hospital_id`, all under RLS, plus 3 `security_invoker` views and 20 SQL functions. This is the most rigorously built layer of the codebase.

### Entity relationships

```
hospitals (tenant root)
 ├─ memberships  (user_id ↔ hospital_id, role)         — a user's login + platform role
 ├─ departments
 ├─ staff  (user_id nullable — a person can exist before they can log in)
 │    └─ referenced by visits.doctor_id, consultations.doctor_id
 ├─ services  (the charge master — consultation/lab/procedure/bed/pharmacy/other)
 ├─ patients  (soft-deleted, never hard-deleted)
 │    └─ visits  (one patient, many visits)
 │         ├─ charge_items  (source: front_desk/doctor/lab/pharmacy/ipd/billing)
 │         │     └─ invoices  (one invoice bills many charge_items)
 │         │           └─ payments  (many payments per invoice; never deleted, only reversed)
 │         └─ consultations  (one row per visit — vitals + free-text notes)
 ├─ number_series  (per hospital · per key · per financial-year counters)
 └─ audit_log  (every mutation on the 11 audited tables, via trigger)
```

### Every table

Column lists below are complete as read from the migrations, not paraphrased. `hospital_id uuid not null references hospitals(id)` is present on every table except `hospitals` itself, which uses its own `id` as the tenant key.

**hospitals** — `id, name, logo_url, address, phone, gstin, settings jsonb, created_at`, plus five columns added by the 2026-08-25 lifecycle migration: `plan` (`trial | standard`), `status` (`active | suspended`), `trial_ends_at`, `suspended_at`, `suspension_reason`. Notably, `authenticated` has column-level `UPDATE` grants only on `name, logo_url, address, phone, gstin, settings` — the lifecycle columns are unwritable from the app layer even though the RLS policy alone would permit it. Belt and suspenders.

**memberships** — `id, user_id → auth.users, hospital_id, role (app_role), is_active, created_at`. `unique(user_id, hospital_id)` — one user can belong to several hospitals, one row per hospital.

**departments** — `id, hospital_id, name, code, is_active, created_at`. `unique(hospital_id, code)` and a case-insensitive unique index on `(hospital_id, lower(name))`.

**staff** — `id, hospital_id, user_id (nullable, on delete set null), full_name, role, department_id, phone, reg_no, consultation_fee numeric(12,2) default 0, is_active, created_at`. A staff record and a login are deliberately decoupled — `staff.role` (job) and `memberships.role` (platform permission) can differ, and do in the seed data: the founder doctor is `doctor` on staff, `super_admin` on her membership.

**patients** — `id, hospital_id, mrn, full_name, dob date, gender, phone, address, created_at, created_by, deleted_at`. `unique(hospital_id, mrn)` is deliberately *not* partial — a soft-deleted patient keeps their MRN forever. Three trigram GIN indexes (name, MRN, digits-only phone) power fast fuzzy search.

**services** — `id, hospital_id, name, category, price numeric(12,2), tax_rate numeric(5,2) 0–100, is_active, created_at` — the GST-aware charge master reused by billing and (eventually) lab/IPD.

**visits** — `id, hospital_id, patient_id, visit_no, token_no, visit_type (opd|ipd|emergency), doctor_id, department_id, status (waiting|in_consultation|completed|cancelled), visited_at, created_by`. A unique index on `(hospital_id, ist_date(visited_at), token_no)` guarantees one queue token per hospital per Indian calendar day — computed via a dedicated immutable `ist_date()` function rather than session timezone, specifically so it's indexable. Streamed to the client via Supabase Realtime.

**charge_items** — `id, hospital_id, visit_id, service_id, description, qty, unit_price, amount, tax_rate, source_module, invoice_id (nullable), status (pending|invoiced|cancelled), created_by, created_at`. Two check constraints do real work: `amount = round(qty*unit_price, 2)` and `(status='invoiced') = (invoice_id is not null)` — the database itself refuses an invoiced line with no invoice, or vice versa.

**invoices** — `id, hospital_id, invoice_no, fy, visit_id, patient_id, patient_name_snapshot, invoice_date, subtotal, tax_total, grand_total, status (unpaid|partial|paid|void), void_reason, created_by`. `grand_total = subtotal + tax_total` and `(status='void') = (void_reason is not null)` are both check constraints, not just app-level rules.

**payments** — `id, hospital_id, invoice_id, amount > 0, mode (cash|upi|card|other), reference, collected_by uuid not null, paid_at, is_reversed, reversal_reason`. `collected_by` has no `on delete` clause at all — deliberately, so a payment record can never be silently orphaned by a user deletion.

**consultations** — `id, hospital_id, visit_id, patient_id, doctor_id, bp_systolic, bp_diastolic, pulse, temperature_f, weight_kg, spo2, notes, created_by/at, updated_by/at`. `unique(hospital_id, visit_id)` — one row per visit, upserted. Vital ranges are enforced as CHECK constraints (e.g. `pulse between 20 and 250`) described in code comments as "typo guards, not clinical opinions." Blood pressure has two extra constraints: both fields present or both null, and systolic must exceed diastolic.

**number_series** — `hospital_id, key (invoice|mrn|visit|token), fy, current_value bigint ≥ 0`, primary key `(hospital_id, key, fy)` — no surrogate id. This is the row that gets `SELECT ... FOR UPDATE`d for every number allocation, exactly as `CLAUDE.md` mandates instead of a Postgres sequence.

**audit_log** — `id, hospital_id, table_name, record_id, action (insert|update|delete), actor_id, before jsonb, after jsonb, at`. Populated entirely by trigger — no code anywhere writes to it directly.

### Enums

| Enum | Values |
|---|---|
| `app_role` | super_admin, admin, doctor, front_desk, cashier, pharmacist, lab_tech, nurse |
| `visit_type` | opd, ipd, emergency |
| `visit_status` | waiting, in_consultation, completed, cancelled |
| `charge_status` | pending, invoiced, cancelled |
| `charge_source` | front_desk, doctor, lab, pharmacy, ipd, billing |
| `invoice_status` | unpaid, partial, paid, void |
| `payment_mode` | cash, upi, card, other |
| `hospital_plan` / `hospital_status` | trial, standard / active, suspended |
| `service_category`, `gender`, `number_key`, `audit_action` | as named — see migrations for full lists |

### The RPCs — where all the real logic lives

Per `CLAUDE.md`'s money rule, there is no client- or server-side `.insert()`/`.update()` anywhere on `patients`, `visits`, `invoices`, `payments`, or `charge_items` — confirmed by grep across the whole app, not assumed. Every mutation on those tables goes through a `SECURITY DEFINER` Postgres function:

| Function | Does |
|---|---|
| `next_number(hospital, key)` | Locks the `number_series` row (`FOR UPDATE`, held to transaction end), increments, formats `PREFIX/FY/00000`. The gapless-numbering mechanism CLAUDE.md asks for. |
| `register_patient(payload)` | Allocates MRN, soft duplicate-phone check (raises `90001` unless `force_create`), idempotent on client-supplied id. |
| `create_visit(payload)` | Allocates visit number, allocates the day's queue token under an advisory lock (`pg_advisory_xact_lock`), optionally raises a consultation charge_item priced at the doctor's own fee. |
| `collect_payment(...)` | The one and only writer of `invoices`. Locks every referenced charge_item `ORDER BY id FOR UPDATE` (explicit deadlock-avoidance ordering, documented in comments), rejects already-invoiced lines with error `90002`, allocates the invoice number *last* so the row lock is held for the shortest possible window, inserts invoice + payment in one transaction. |
| `void_invoice(id, reason)` | Requires ≥4-char reason, releases charge_items back to `pending`, reverses payments (not deletes) — never deletes the invoice, number stays consumed. |
| `day_close_report(hospital, date)` | Read-only, `SECURITY INVOKER` (the one exception — RLS alone scopes it). Returns collected/invoiced/voided totals plus by-mode/by-staff/by-department breakdowns. |
| `save_consultation(payload)` | Upserts vitals+notes for a visit, transitions visit status in the same transaction. A doctor may only write a visit booked to *them* — nurses and admins are exempt from that check. |
| `provision_hospital()` | Self-serve tenant creation on signup. Advisory-locked per user to stop a double-submit from creating two hospitals. Idempotent. |
| `attach_staff_login(...)` | Links an invited auth user to a pre-existing staff record; admin-only, refuses to mint `super_admin`. |
| `hospital_lifecycle_state / hospital_is_active` | Single source of truth for trial/suspended/active, consumed by a `BEFORE INSERT OR UPDATE` trigger (`enforce_hospital_active`) attached to 10 of the 13 tables. |

### RLS coverage

**All 13 base tables have `ENABLE ROW LEVEL SECURITY`.** None are missing it. The pattern is consistently the coarse-net design `CLAUDE.md` asks for: SELECT policies scoped by `hospital_id = app_hospital_id()` (read from JWT `app_metadata`, never a subquery) plus a role check where relevant; money tables (`charge_items`, `invoices`, `payments`) have **no INSERT/UPDATE policy at all** — the only way in is the SECURITY DEFINER RPCs. **No table anywhere has a DELETE policy** — deliberate, matching the no-hard-delete rule. The three read views (`visit_queue`, `visit_billing`, `invoice_summary`) are declared `security_invoker = on` so they inherit the querying user's RLS rather than the view owner's.

### Custom access token hook

Runs as `supabase_auth_admin` (not `SECURITY DEFINER` — granted direct `SELECT` on `memberships` via a dedicated policy instead). Resolves the caller's active membership, injects `app_metadata.hospital_id` and `app_metadata.role`, and fails closed — explicit JSON `null` for both claims — when no membership is found, rather than omitting the keys.

### Storage

One bucket, `branding` — public read (so a printed receipt's logo loads without a session), admin-only write scoped to the tenant's own folder prefix via `(storage.foldername(name))[1] = app_hospital_id()::text`. 2MB limit, PNG/JPEG/WebP/SVG only.

### Seed data

`seed.sql` is unusually disciplined: it doesn't `INSERT` into money/patient tables directly — it calls `register_patient`, `create_visit`, `collect_payment`, and `save_consultation`, i.e. it exercises the exact same RPCs the app uses. One demo hospital (Sunrise Multispeciality), 3 departments, 5 staff (3 doctors, front desk, cashier), a real Supabase Auth login wired to the founder doctor, 12 charge-master services, 20 patients (deliberately including a leap-day birthday, an infant, a phone-sharing mother/daughter pair to exercise the duplicate-phone path), 10 visits for "today," up to 5 invoices including one voided, and consultation notes on the finished visits. Idempotent — safe to re-run.

### Types vs. migrations — a real discrepancy

> **⚠ Generated types are stale in two concrete ways (confirmed)**
>
> `types/database.ts` is hand-written and its own header admits the lifecycle columns/enums (2026-08-25 migration) were never machine-verified against the live schema — the project can't currently reach the hosted DB to run `db:types` from this network (no IPv6). Cross-checking against the SQL: **`hospital_plan` and `hospital_status` are missing from the `Enums` map** even though the TS union types exist and are used correctly in the Row shapes, and **`provision_hospital()` and `attach_staff_login()` are entirely absent from `Functions`** — not flagged anywhere in the file's own staleness disclaimer, which only calls out the lifecycle columns. `lib/rpc/onboarding.ts` works around this with a manual client type-cast, with removal instructions left in a comment. A real `npm run db:types` run is overdue once network access allows it.

---

## 3. Authentication & Authorization

Email/password via Supabase Auth, cookie-based sessions through `@supabase/ssr`. Role and tenant live on the JWT, not in application state, and the database — not the UI — is treated throughout as the actual security boundary.

### How a session comes to exist

**Signup** (`/signup`): collects hospital name, full name, email, password (≥8 chars — Supabase Auth owns the real strength policy). After `auth.signUp()`, calls RPC `provision_hospital()`, which reads `hospital_name`/`full_name` from the user's own `auth.users.raw_user_meta_data` (never from a request argument, so nobody can provision a hospital on someone else's account), then `refreshSession()` to pick up the fresh JWT claims. Handles Supabase's "this email already exists" response by redirecting to `/login?reason=check_email` rather than confirming account existence — anti-enumeration by construction.

**Login** (`/login`): thin form, `signInWithPassword()`, then reads claims. Distinguishes "no membership at all" from "has an active membership but the claims never arrived" (the latter means the JWT hook isn't enabled on the project) with different messaging. Open-redirect protection on the `next` query param — same-origin only, no `//`, no looping back into `/login`.

**Staff invite**: a three-step flow — `attach_staff_login` RPC checks for an existing auth user by email; if none exists, the service-role admin client (the only place it's used outside provisioning) sends a Supabase invite email; `attach_staff_login` is called again once the invite is accepted, linking the new login to the pre-existing `staff` row.

**Session refresh**: `proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; logic still lives at `lib/supabase/middleware.ts` per the project's own directory convention) runs on every non-static request and calls `getUser()` — never the cheaper `getSession()` — specifically because `getSession()` trusts the cookie without revalidating against the auth server. Same reasoning is repeated at `lib/auth/session.ts`'s `getCurrentUser()`.

### How hospital_id/role reach server code

The custom access token hook (§2) injects both into `app_metadata`. `getClaims()` in `lib/auth/session.ts` (wrapped in React's `cache()` to dedupe per request) calls `supabase.auth.getClaims()`, which verifies against the project's JWK — a real signature check, not a raw JWT decode. Two guarded entry points consume it:

- **`requireSession()`** — For Server Components. Redirects to `/login?reason=<why>` on failure — `signed_out`, `no_membership`, or `hospital_missing`.
- **`requireSessionForAction()`** — For Server Actions, which are directly POST-reachable and can't rely on a page-level redirect. **Throws** instead, and is the single choke point that blocks writes when the hospital's lifecycle state isn't `active`. Reads are never blocked this way.

### Roles

Eight roles, defined in Postgres and re-exported into TypeScript from the generated `Database['public']['Enums']['app_role']` type — so a role added in SQL but forgotten in the label map is a compile error, not a silent gap:

`super_admin · admin · doctor · front_desk · cashier · pharmacist · lab_tech · nurse`

(`pharmacist` and `lab_tech` already exist in the enum for Phase 2 modules that aren't built yet — the type is ready, the UI and RPCs are not.)

| Role group | Members | Can access |
|---|---|---|
| ADMIN_ROLES | super_admin, admin | Hospital settings, departments, staff, invite staff |
| FRONT_DESK_ROLES | + front_desk | Patient search/register, start visits, queue board |
| BILLING_ROLES | + cashier | Collect payment, void invoice, day close, invoice list |
| CLINICAL_ROLES | + doctor, nurse | Doctor's queue, save vitals/notes (nurse can chart vitals pre-doctor) |

This is **centralized** in one file, `lib/roles.ts`, reused by both the sidebar-filtering logic and every Server Action's role check — but every helper's docstring is explicit that it is *not* the actual security boundary: each one names the exact Postgres function it must be kept in sync with (`is_hospital_admin()`, `assert_front_desk()`, `assert_billing()`, `assert_clinical()`). The sync between the TS helper and the SQL function is by convention, not enforced by tooling — a real, if minor, drift risk. A role check happens at three independent layers: page/layout gate (shows `<AccessDenied>`, not a silent redirect — deliberate, since a bounce reads as a broken link on a shared front-desk terminal), Server Action re-check, and the RLS/RPC layer underneath, which is the one that actually matters if the first two are ever bypassed.

### Session state

Pure cookie-based JWT session via `@supabase/ssr` — no separate session table, no client-side auth store beyond what Supabase's client already holds. A fresh server client is created per request rather than a module-level singleton, specifically to avoid leaking one user's session into another request.

### Tenant lifecycle

Three states — `active`, `suspended`, `trial_expired` — computed identically on both sides: `hospital_lifecycle_state()` in Postgres is the actual enforcement (via the `enforce_hospital_active` trigger on 10 tables), and `lib/hospital-lifecycle.ts` duplicates the same logic in TypeScript purely to avoid a second round-trip, since the hospital row is already in hand. A trial with no `trial_ends_at` set never expires — deliberate, to avoid retroactively locking out hospitals created before lifecycle tracking existed. Suspension is read-only, not lockout: existing records stay viewable and printable, only new writes are blocked, and the blocking messages are hospital-facing and specific ("This hospital is suspended... Existing records can still be opened and printed.").

---

## 4. Features — What's Actually Built

Every module below was read line-by-line, not inferred from route names. The headline finding: **nothing audited is a UI shell.** Every screen that exists is wired end-to-end to a real RPC or a real RLS-scoped query, with loading states, error states, and a documented rationale for its harder design calls.

### Hospital onboarding & registration — `Working`

Self-serve: `/signup` → `provision_hospital()` creates the hospital, an `admin` membership, and a founder `staff` row in one transaction, advisory-locked per user against double-submit. Deliberately seeds *nothing else* — no departments, no default services — because inventing prices in a billing system by default is treated as a hazard, not a convenience.

### Dashboard — `Minimal`

`/` ("Today's overview") is the one nav item visible to every role regardless of permissions, and admins land here after login. It is not a metrics dashboard in the BI sense — no charts, no KPI tiles beyond what day-close already provides on its own page. This is the thinnest part of the built surface.

### Patient management — `Working`

`/front-desk/register` is genuinely search-first, exactly as `CLAUDE.md` demands: the empty state literally warns "Registering a patient who is already on file splits their history in two," and the register dialog only opens via an explicit action (F2, a button, or Enter with zero matches) — never as the default view. Duplicate-phone handling surfaces Postgres error `90001` as a live search-and-choose UI rather than a hard failure, with an explicit "different person, register anyway" override that flips `force_create`. Fully keyboard-operable: autofocus on load, `↑/↓` to move through matches, `Enter` to act, `Escape` to clear, global `F2`/`/` shortcuts, visible `<kbd>` hints (hidden below the `lg:` breakpoint, though the shortcuts themselves keep working).

### Doctor/staff management — `Working`

`/admin/staff`: create/edit via upsert with a client-minted UUID, deactivate only behind a typed-confirmation dialog (never delete), and the invite flow described in §3. A staff record with no login (`user_id null`) is a first-class, intentional state — it's how a hospital can pre-load its roster before anyone has an account.

### Appointment booking & scheduling — `Queue, not calendar`

There is no advance-booking or calendar module. What exists is a same-day walk-in queue: `create_visit` allocates a sequential token per hospital per day, the doctor's `/doctor/queue` subscribes to it live via Supabase Realtime (debounced 250ms, explicit "Live"/"Connecting…" indicator), and consultation is opened straight from the queue. This matches an OPD walk-in clinic's actual workflow, not a scheduled-appointment system — worth flagging if the product pitch implies the latter.

### Billing & payments — `Working — no gateway`

`/billing/collect` is the most keyboard-dense screen in the app: `Alt+1..4` switches payment mode, `Alt+A` focuses amount, `Alt+S` opens the service picker, `Ctrl/Cmd+Enter` submits, all with visible hints. Tax is computed server-side per line from `services.tax_rate` — the client never sends a tax figure. Payment modes are cash/UPI/card/other *recorded*, not processed — **no payment gateway is integrated.** UPI/card payments are collected at the counter by other means and simply logged here with a mode and an optional reference string. `/billing/invoices` supports void (typed reason required, ≥4 chars, enforced client + server + DB CHECK) and print. `/billing/day-close` is a read-only report — collections by mode/staff/department for a given day, navigable but not exportable.

### Prescription / medical records — `Vitals + free-text only`

`/doctor/visit/[id]` captures six vitals (BP, pulse, temperature, weight, SpO2) and a free-text notes field — no structured diagnosis codes, no prescription/medication module, no drug interaction checking. This is explicitly by design per an in-code comment: "structured history and prescriptions come in a later phase." One notably careful behavior: if the existing consultation record fails to load, **the form does not render at all**, because `save_consultation` replaces rather than merges — opening a blank form on a read failure would risk silently wiping a doctor's prior notes. This is the single most defensive error-handling pattern found anywhere in the codebase.

### Reports / analytics — `Day close only`

The only report is day-close (collections/invoiced/voided, broken down by payment mode, staff, department). No trend reporting, no patient-volume analytics, no exportable/scheduled reports.

### Notifications — `Not built`

No email notifications beyond what Supabase Auth sends natively (invite, password reset, confirmation). No SMS. No in-app notification center. No queue-position alerts to patients.

### Settings / configuration — `Working`

`/admin/settings`: hospital name/address/phone/GSTIN (structural regex validation, not a checksum), logo upload to the `branding` Storage bucket with old-logo cleanup that deliberately runs *after* the DB row update succeeds, to avoid orphaning storage on a failed write. Print-format default (thermal vs A4) is a hospital setting, not hardcoded.

### Not present anywhere

Lab (test orders/results), Pharmacy (stock/dispense), IPD (beds/admission/discharge) — zero tables, zero routes, zero nav entries. This is a correct, deliberate absence per the project's own phase-gating rule, not an oversight; flagged here only so the feature list is honest about scope.

---

## 5. API Layer

There is no conventional REST/GraphQL API. `app/api/` contains a single `.gitkeep` and nothing else — reserved by convention for print/PDF routes, unused so far because print is currently served as a normal authenticated route (`/print/invoice/[id]`) rather than an API handler. The real API surface is **Postgres, reached two ways.**

### Surface 1 — RPCs (all mutation, all validated server-side)

| RPC | Wrapper | Protected by |
|---|---|---|
| `provision_hospital` | `lib/rpc/onboarding.ts` | Must be signed in; reads own metadata only |
| `attach_staff_login` | `lib/rpc/onboarding.ts` | `is_hospital_admin()`, refuses super_admin grants |
| `search_patients` | `lib/rpc/patients.ts` | RLS (SECURITY INVOKER, read-only) |
| `register_patient` | `lib/rpc/patients.ts` | `assert_front_desk()` |
| `create_visit` | `lib/rpc/visits.ts` | `assert_front_desk()` |
| `collect_payment` | `lib/rpc/billing.ts` | `assert_billing()` |
| `void_invoice` | `lib/rpc/billing.ts` | `assert_billing()` |
| `day_close_report` | `lib/rpc/billing.ts` | RLS (SECURITY INVOKER, read-only) |
| `save_consultation` | `lib/rpc/consultations.ts` | `assert_clinical()` + own-visit check for doctors |

Every RPC wrapper takes the Supabase client as a parameter rather than constructing its own, so the same function works identically whether called from a Server Action (signed-in RLS) or elsewhere. None of them unwrap or throw on `{data, error}` — the raw Supabase response is returned and interpretation is pushed to the caller, which typically routes through `lib/supabase/errors.ts`'s `describeDatabaseError()`.

### Surface 2 — direct reads via Supabase-js + RLS

Server Components and one client-side TanStack Query hook (pending charges on the billing screen) read tables and views directly through the anon key, with Postgres RLS doing all the tenant/role filtering — no custom read API was written because none was needed. Confirmed by grep: the only `.from('charge_items')`/`.from('payments')` calls anywhere in the app are `.select()`, never a write.

### Documentation

No Swagger/OpenAPI spec, no Postman collection — appropriate given there's no conventional HTTP API surface to document; the RPC signatures live in the SQL migrations and the typed wrapper functions instead.

### Error handling

Business-rule violations are raised as Postgres exceptions with custom error codes (`90001` duplicate phone, `90002` already-billed) that the UI pattern-matches on to render a specific recovery flow, rather than a generic failure toast. Everything else surfaces through `FormMessage`/toast components as a plain readable message — the project's own rule ("never swallow an error into a silent no-op") holds up under inspection; no empty catch blocks were found anywhere in `lib/`, and the one intentional `catch {}` (a cookie-set failure inside a Server Component, which cannot set cookies by React's own rules) is commented with why it's safe.

---

## 6. Frontend Architecture

### Every route

- `/` — Today's overview — every role, redirect target
- `/admin, /admin/settings, /admin/departments, /admin/staff` — admin, super_admin only
- `/front-desk/register, /front-desk/queue` — front_desk + admin roles
- `/billing/collect, /billing/invoices, /billing/day-close` — cashier + admin roles
- `/doctor/queue, /doctor/visit/[id]` — doctor, nurse, admin
- `/print/invoice/[id]` — billing roles — thermal/A4, ?autoprint=1, ?format=
- `/login, /signup, /set-password, /auth/confirm` — public route group

### State management

No Redux/Zustand/Context-as-global-store. TanStack Query is used narrowly and deliberately: patient search-as-you-type and the billing screen's pending-charges list — both fast, cacheable reads with a 30s stale time and `refetchOnWindowFocus: false`. One `QueryClient` instance per browser session, constructed inside `useState` rather than a module singleton, specifically to avoid leaking cache across tenants during SSR. Every mutation is a Server Action → RPC; TanStack Query never touches a write.

### UI library

shadcn/ui, and a deliberately small slice of it — 12 primitives (button, card, checkbox, dialog, dropdown-menu, input, label, select, separator, sonner/toast, table, textarea, badge). Notably absent: `sheet`, `tabs`, `tooltip`, `popover`, `avatar`, `alert`, `skeleton` — nothing beyond what Phase 0/1 screens actually needed was installed.

### Responsiveness

Mixed and intentional, not accidental. The app shell (sidebar) collapses to a permanent icon-only rail below the `md:` breakpoint and expands to icon+label above it — a fixed responsive rail, not a drawer/sheet/hamburger (no `sheet.tsx` component even exists in the primitives set). Work screens (front-desk register, queue, billing collect) use fixed dense-grid layouts with minimal breakpoint coverage — this is explicit per `CLAUDE.md`'s "these are work screens, not marketing pages" directive, and matches its stated audience: staff on a fixed front-desk terminal, not a phone. Auth screens (login/signup) are simple centered single-column cards that need no breakpoints at all. In short: **the app is responsive where it needs to be and dense-desktop where the domain calls for it** — not an oversight, a call.

### Reusable component library

A small, well-considered shared set: `MoneyInput` (₹-prefixed, right-aligned, `tabular-nums`, deliberately `type="text"`+`inputMode="decimal"` rather than `type="number"` — the comment explains a native number input can silently drop a keystroke or change value on an accidental scroll-wheel while focused), `PrintLayout` (thermal/A4 shared chrome), `SubmitButton` (reads `useFormStatus()` so pending/disabled state needs no prop drilling), `FormMessage`/`Field` (consistent error/hint rendering), `PageHeader`. All satisfy the money-formatting and keyboard-first UI rules from `CLAUDE.md` directly, with the reasoning left in comments rather than asserted.

---

## 7. Deployment & Infrastructure

> **⚠ No CI, no deployment config, anywhere (gap)**
>
> No `Dockerfile` (correct — the project's own rule is "No Docker. Ever."), no `vercel.json`, no `netlify.toml`, no `.github/` directory, no `*.yml` anywhere outside `node_modules`. `npm run lint`, `typecheck`, and `test` all exist as scripts but nothing runs them automatically on push or PR. For a 3-developer team with no hard deadline this may be an accepted tradeoff rather than an oversight, but it's a real gap against any production launch.

### scripts/db.mjs

A hand-rolled Node CLI (`push`/`seed`/`types`/`repair`) that exists specifically to route around two constraints: Windows shell variable expansion differences, and the fact that this project has no Docker while the Supabase CLI's `--db-url` type-generation path normally spins one up. `push`/`seed` pass the connection string as a discrete `argv` element to a subprocess spawned *without a shell* — a deliberate choice, documented in a comment, to avoid the connection string (which contains `?`, `&`, `@`) being reinterpreted by `cmd.exe`. `types` instead authenticates via a personal access token against the Management API, and validates the output contains `export type Database` before overwriting the existing file — a corrupt generation leaves the old file untouched rather than clobbering it. No SQL is ever built as a string and executed by this script.

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server Supabase project URL. Validated as a URL, read via literal `process.env.*` access so Next's bundler can inline it client-side. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key — RLS is the actual gate behind it. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only, bypasses RLS. No `NEXT_PUBLIC_` prefix (never bundled client-side), read lazily so its absence only breaks the admin client. Restricted by convention to `lib/supabase/admin.ts`, used only for hospital provisioning and pre-JWT membership reads. |
| `SUPABASE_DB_URL` | Used only by `scripts/db.mjs` — direct connection or session pooler (transaction pooler can't hold the advisory locks migrations need). Never read by the running app. |
| `SUPABASE_ACCESS_TOKEN` | Personal access token, used only by `db:types`' Management API call. |

Validation is lazy (first access, memoized) rather than at module load, so `next build` doesn't require a live connection — it fails loudly only when a request actually needs a client.

### Where it runs

Database: Supabase hosted, Mumbai (`ap-south-1`). Application: nothing observed in the repo indicates a chosen host — no platform-specific config for Vercel, Netlify, Railway, etc. exists. `next dev` on port 3000 via `.claude/launch.json` is a local editor debug config only, not a deployment target.

### Security housekeeping — confirmed clean

> **✓ `.env` was never committed (verified)**
>
> `git ls-files | grep -i env` shows only `.env.example` and `lib/env.ts` tracked. `git log --all --full-history -- .env` is empty — it has never existed in history at any point, not even a since-removed commit. `.gitignore` correctly excludes `.env*` while explicitly allowlisting `.env.example`. This is worth stating plainly as a positive finding, not just an absence of a negative one.

---

## 8. What's Missing / Not Yet Built

Measured against what an Indian hospital SaaS eventually needs, and against the codebase's own stated roadmap in `CLAUDE.md`.

### Correctly out of scope (Phase 2/3, not built by design)

- **Lab module** — test orders, status tracking, result upload. Zero tables, zero routes.
- **Pharmacy module** — purchase entry, dispense, FEFO stock ledger. Zero tables, zero routes. (The append-only `stock_ledger` design and "no mutable quantity column" rule exist only in `CLAUDE.md` prose, not in SQL yet.)
- **IPD** — beds, admission, daily charge accrual, discharge. `visit_type` enum already includes `ipd` as a value, but front-desk forms explicitly restrict selectable types to `opd`/`emergency` — the door is left ajar in the type system but firmly shut in the UI.

### Genuine gaps, not phase-gated by the spec

- **No payment gateway** — cash/UPI/card/other are recorded as a mode + optional reference, never processed. Any UPI/card payment happens by some out-of-band means (a separate terminal, a UPI app) and is simply logged after the fact.
- **No notifications** beyond Supabase Auth's own transactional email (invite, confirm, reset). No SMS, no in-app notification center, no patient-facing queue alerts.
- **No hospital switcher UI** — `memberships` explicitly supports one user belonging to multiple hospitals, and the JWT hook even reads an optional client-requested `active_hospital_id`, but `user-menu.tsx` has no control to actually switch. The backend is ready; the frontend for this specific case was never built.
- **No prescriptions/structured diagnosis** in the doctor module — free-text notes only, explicitly deferred by the code's own comments.
- **No CI/CD** (§7) — a real gap for any production launch, whatever the reason for its current absence.
- **No export/scheduled reporting** — day-close is on-screen only, no CSV/PDF export, no email digest.

### TODO/FIXME/placeholder scan

> **✓ None found, anywhere (unusual)**
>
> Every one of the four parallel audits searched their assigned files for `TODO|FIXME|XXX|HACK|placeholder|not implemented|coming soon` and came back empty across `supabase/`, `lib/`, `app/`, and `components/`. The codebase substitutes long-form prose comments explaining *why* a decision was made — including deliberately documented open design tensions (e.g. `next_number`'s per-financial-year keying vs. per-day token semantics) and explicit "POLICY DECISION" markers — rather than TODO-style stubs. This is unusually complete for a project self-described as "Phase 1, in progress," and worth taking as a genuine signal rather than a coincidence of what got searched.

---

## 9. Code Quality & Concerns

### Findings, most consequential first

> **⚠ Test coverage is a single, narrow (if excellent) file — real gap**
>
> `tests/collect-payment-concurrency.test.mjs` is the *only* test file in the repository. What it tests, it tests very well — real lock contention against the real hosted Postgres instance (no mocks, via `pg_stat_activity` polling), covering four scenarios: sequential numbering across concurrent cashiers, 8-way simultaneous collection staying gapless, a rolled-back collection returning its number rather than burning it, and double-billing the same visit correctly failing with error `90002`. It's a genuinely rigorous regression test for the single highest-liability code path (money). But it covers *only* that path — no automated coverage exists for `register_patient`'s duplicate-phone logic, `void_invoice`, `day_close_report`, RLS policies, any Server Action, or any UI component. If `SUPABASE_DB_URL` is unset, the suite is silently *skipped*, not failed — `npm test` passing proves nothing in that case, which is easy to miss in a quick "tests pass" check.

> **✓ No direct writes to money/patient tables anywhere — verified by grep**
>
> The RPC-only rule in `CLAUDE.md` §3.2 holds up under an actual grep, not just a read of the intent: the only `.from('charge_items')`/`.from('payments')`/`.from('invoices')` calls in the whole app are `.select()` reads (the print invoice page, the billing collect screen's pending-charges query). Every write goes through a SECURITY DEFINER RPC. This is the single strongest structural guarantee in the codebase.

> **⚠ Indian financial-year logic is manually duplicated between SQL and TypeScript — self-flagged**
>
> `lib/utils/financial-year.ts`'s own comment admits it: "the database is the authority — numbers are allocated there. This exists for display and filtering. If one changes, change both." A genuine drift risk if the Postgres `financial_year()` function is ever edited without a matching TS change — flagged by the code itself, not inferred.

> **⚠ RBAC sync between TypeScript and Postgres is convention, not enforced — design tradeoff**
>
> `lib/roles.ts`'s helper functions (`isAdminRole`, `isFrontDeskRole`, etc.) each carry a comment naming the exact Postgres function they must track (`is_hospital_admin()`, `assert_front_desk()`...), but nothing in the build actually verifies the two stay aligned if one side is edited. Low risk in practice, since RLS/RPC checks are the real gate and a UI-side drift would only ever be *more* restrictive than the database, not less — but worth a lint rule or shared codegen eventually.

> **✓ Money handled correctly throughout — verified**
>
> `numeric(12,2)` in Postgres, all client-side arithmetic routed through integer paise (never raw floats) before formatting back to `₹` via `Intl.NumberFormat('en-IN', ...)`. GST is computed per line, never as a blanket invoice rate — both print templates and the RPC agree on this. `parseMoney()` returns `null` rather than `NaN` on bad input, forcing callers to handle it explicitly.

> **✓ Deadlock avoidance is explicit and documented — verified**
>
> `collect_payment` locks referenced `charge_items` in a fixed `ORDER BY id` before ever touching the `number_series` row inside `next_number`, with an explicit comment establishing this lock ordering as a whole-codebase invariant that must never be reversed. This is a level of concurrency care well above what most projects at this stage bother with.

> **⚠ Two RPCs bypass generated types with a manual cast — known debt, self-documented**
>
> `lib/rpc/onboarding.ts` casts the Supabase client to call `provision_hospital`/`attach_staff_login` because `types/database.ts` hasn't caught up (see §2). The comment gives exact removal instructions once `db:types` can run again. Not a silent gap, but it does mean these two calls currently have no compile-time protection against a signature change.

### Input validation

Genuinely dual-sided: every form uses a Zod schema from `lib/schemas/` that's imported by both the client component and the Server Action, so client and server validate identically by construction rather than by discipline. The database then re-validates the domain-critical subset as CHECK constraints and RPC-body assertions (vital ranges, BP pairing, money non-negativity, void-reason length) — three layers, not just two, for the fields that matter most.

### Sensitive data handling

No column-level encryption on patient PII (name, DOB, phone, address) — protection is entirely RLS + transport TLS + Supabase's own at-rest encryption, which is the standard posture for this class of hosted-Postgres app but worth naming explicitly since this is medical data. No field-level audit of *who viewed* a patient record, only who *mutated* one (the `audit_log` trigger fires on insert/update/delete, not select) — a read-access audit trail is absent, which matters more for compliance regimes that require it than for this project's current stated scope.

### Hardcoded values that should be config

Nothing egregious found. The financial-year duplication above is the only real instance of logic that should have one source of truth but has two.

---

## 10. Third-Party Integrations

| Service | Status | Note |
|---|---|---|
| Supabase (Postgres, Auth, Storage, Realtime) | **Integrated** | The entire backend. Region-pinned to Mumbai. Everything in §2–3 depends on it. |
| Payment gateway (Razorpay/Stripe/etc.) | **Not integrated** | No SDK installed, no dependency present. Payments are recorded, not processed. |
| SMS provider | **Not integrated** | No dependency, no code path. |
| Email | **Partial — Supabase Auth only** | Transactional auth email (invite/confirm/reset) via Supabase's built-in email, not a dedicated provider like Postmark/SES. No application-level notification email. |
| Cloud storage | **Integrated** | Supabase Storage — the `branding` bucket for hospital logos. Nothing else uses storage yet (no scanned documents, no lab result files — expected, since Lab isn't built). |
| PDF/print rendering | **Integrated, no Chromium** | Deliberately not server-rendered PDF — pure HTML + `@media print` CSS, per `CLAUDE.md`'s explicit "no Chromium on serverless" rule. Genuinely simpler and more reliable for this use case than a headless-browser PDF pipeline would have been. |

All dependencies (`package-lock.json`) sit on current major versions — Next 16.3.1, React 19.2.8, Zod 4.4.3, TypeScript 5.9.3, `@supabase/supabase-js` 2.112.3 — nothing on an old or abandoned major that would be a red flag at a glance. No deep vulnerability scan was run as part of this audit.

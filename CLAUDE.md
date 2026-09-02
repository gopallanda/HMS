# Hospital Management System — Project Context

Read this file before any task. These rules override general best-practice defaults.

---

## 1. What we're building

A hospital management system for small Indian hospitals and clinics (20–100 beds).
Deployed to one hospital first; sold as multi-tenant SaaS later.

Team: 3 developers. No hard deadline. Priority is a correct foundation over feature count.

### Modules (build order)

| # | Module | Phase |
|---|---|---|
| 1 | Admin — branding, departments, staff, roles | 0 |
| 2 | Front desk — patient registration, visits, queue | 1 |
| 3 | Billing — charges, invoices, payments, day-close | 1 |
| 4 | Doctor — today's queue, consultation notes | 1 (minimal) |
| 5 | Laboratory — test orders, status, result upload | 2 |
| 6 | Pharmacy — purchase entry, dispense, stock levels | 2 |
| 7 | IPD — beds, admission, daily charge accrual, discharge | 3 |

**Do not build Phase 2 or 3 tables, routes, or UI unless the task explicitly says so.**

---

## 2. Stack

- Next.js (App Router) + TypeScript strict mode
- Tailwind CSS + shadcn/ui
- Supabase — Postgres, Auth, Storage, Realtime (region: Mumbai, `ap-south-1`)
- Zod for validation, shared between client and server
- TanStack Query for client-side cache
- Supabase CLI for migrations — **never make schema changes in the dashboard**

### No Docker. Ever.

This project targets the **hosted** Supabase project (region: Mumbai,
`ap-south-1`). There is no local Docker stack and no `supabase start`.

- Never start Docker, `supabase start`, or a Postgres container — not to run
  the app, not to apply migrations, and not to "just validate some SQL".
- Migrations, type generation, seeds and tests all run against the hosted
  project through `SUPABASE_DB_URL` in `.env.local`:

  ```
  npm run db:push       apply supabase/migrations
  npm run db:types      regenerate types/database.ts
  npm run db:seed       run supabase/seed.sql
  npm test              money tests, against the same connection
  ```

- If `SUPABASE_DB_URL` is missing, **ask for it**. Do not stand up a local
  database as a substitute — a shimmed Postgres is not the database this code
  runs on, and anything it proves has to be proved again anyway.

---

## 3. Non-negotiable rules

These exist because they are cheap now and require data migration later.

### 3.1 Multi-tenancy

- Every table has `hospital_id uuid not null references hospitals(id)`. No exceptions.
- Every unique constraint is **scoped**: `unique(hospital_id, mrn)`, `unique(hospital_id, invoice_no)`. Never a global unique on a business key.
- Every composite index leads with `hospital_id`.
- `hospital_id` and `role` are read from JWT claims, never from a subquery inside an RLS policy.

### 3.2 Money

- **Never** insert or update `invoices`, `payments`, or `charge_items` directly from client or server-action code. All writes go through Postgres functions (RPC) that run in a single transaction.
- Invoice numbers come from the `number_series` table via `SELECT ... FOR UPDATE`. **Never** use a Postgres sequence — numbering must be per-hospital and per-financial-year, and sequences leak gaps on rollback.
- Invoices are **never deleted**. Void with a reason; the number stays consumed.
- Every payment records `mode` (cash / upi / card / other) and `collected_by`. These are required, not nullable.
- Money is stored as `numeric(12,2)`. Never float.

### 3.3 Patients

- Store `dob date`, never an age integer. Compute age for display.
- Registration is **search-first**: search by phone → if found, create a new visit on the existing patient; only create a patient when nothing matches. Never open a blank create-form as the default path.
- **A phone number identifies a household, not a person.** Families share one mobile; that is the norm, not an anomaly. There is no unique constraint on it and no path in the app blocks on it. The matches panel on the register screen is neutral information with a *Use this patient* button — what prevents a duplicate MRN is that it makes the repeat visit two clicks, never that it refuses the save.
- **Registration is ONE RPC in ONE transaction**: `register_patient_visit` writes the patient and MRN, the visit and visit number, the token, the invoice and invoice number, and the payment or the deferral — or none of them. A visit with no doctor, no token and no money asked for is invisible to every screen in the product, and the fix for that is the shape of the write, not a required field on a form. `register_patient` and `create_visit` still exist for the emergency and service-role paths; the desk never calls them directly.
- **Tokens are per hospital, per doctor, per day**, from 1. "Number 7" has to mean *seventh patient waiting for Dr Rao*, not seventh through the door.
- **The doctor completes a visit from the queue, not from the notes.** Most
  OPD encounters are never typed on, so a board that only advances when
  somebody saves a consultation never advances at all: tokens stop rotating
  and the waiting count the register desk prints beside each doctor is wrong
  by mid-morning. `set_visit_status` is the button; `save_consultation` still
  moves the status when a note IS written, and the two agree.
- **A visit's doctor changes only through `transfer_visit`** — a named action with a required reason, which issues a new token at the back of the new doctor's queue and retires the old one. The old number is never reused: somebody is holding a printed slip with it on.
- Patients are soft-deleted (`deleted_at`), never hard-deleted.

### 3.4 Stock (Phase 2 — obey when you get there)

- Stock is an append-only `stock_ledger` (batch, expiry, qty_in, qty_out, reason, ref).
- **Never** a mutable `quantity` column on a drug row. Current stock is derived.
- Dispensing is FEFO (first-expiry-first-out).

### 3.5 Audit

- All mutations on `patients`, `visits`, `invoices`, `payments`, `charge_items` write to `audit_log` via a Postgres trigger.
- Nothing in the app hard-deletes a row. Use `deleted_at` or a status column.
- One deliberate exception: a `staff_shifts` cell can be cleared. "Nothing recorded" is a distinct answer from "day off", and the absence of a row is the only way to say it. The audit trigger keeps the history.

### 3.6 Identity, roles and permissions

Added by the Phase 1 remediation. These replace the assumption that a person is
their `app_role`.

- **Department ≠ role.** Department is *where* somebody sits (Cardiology, Housekeeping); role is *what they do* and therefore what they may open. They are independent columns on `staff`, and no permission is ever keyed off a department. A nurse in Cardiology and a nurse in Housekeeping hold the same role.
- **Not every role logs in.** `roles.can_login = false` (Cleaner, Security) is a staff record with a roster and no credentials. The staff form hides the whole credentials section for those roles.
- **Roles are data, permissions are code.** `public.roles` and `public.role_permissions` are per hospital and editable at `/admin/roles` without a deploy. The permission *keys* are a frozen string union in `lib/rbac/permissions.ts` — never a table. A key in the database that is not in that union is dropped on load, so it cannot grant something nothing enforces.
- **Guard on permissions, not on role names.** Admins can create custom roles, so a hardcoded switch on role strings locks every custom role out of everything. `checkPermission()` / `requirePermission()` in `lib/auth/session.ts` is the real boundary and goes at the top of every mutating Server Action.
- **Three layers, and only one of them is a control.** The proxy guards the route, `requirePermission()` guards the Server Action, `<Can>` hides the button. The action is the real boundary — a POST reaches it without passing through either of the others. A `<Can>` wrapped around a form whose action has no check is a permission bug wearing a permission check.
- **One shell, not four portals.** Everybody gets the same layout with the nav filtered by permission. Separate app trees per role would triple the surface for three developers and the isolation would be cosmetic anyway: it comes from the guard, not from the URL prefix.
- **The two route maps live in `lib/rbac/routes.ts`.** `ROUTE_PERMISSIONS` (longest prefix wins) is what the proxy guards on; `ROLE_HOME` is the only place a role *name* is still consulted, and only to pick a landing page — an unknown custom role falls through to the first screen its permissions allow. A path with no entry is open to any signed-in member of the hospital, so a new screen carrying data needs a line there.
- **A refused route redirects home with `?denied=`, never to a 403.** A dead end leaves a clerk stuck; their own landing screen plus one sentence lets them carry on and gives them something to repeat to an administrator.
- **The proxy strips inbound `x-hms-*` headers before setting them.** Anything downstream reads them as verified identity, so an unstripped request is a forged session.
- **`super_admin` is the one membership role that overrides the staff role**, because it already opens every RLS policy — withholding a permission from it in the app would be theatre. `admin` deliberately does not, or every Manager would gain `settings.manage`.
- `staff.role` (the old `app_role`) still exists and is **derived from `role_id` by trigger**. Do not write it. It survives only because `create_visit` still checks it; it goes when that check does.
- **Credentials are handed over at the desk. There is no invitation email.** Staff in a small Indian hospital do not have work mailboxes and will not complete an email round trip before their first shift. `provisionStaffAccount` returns a username and a temporary password, shown once, with copy buttons, and there is no "show it again" anywhere. Lost credentials → reset, which mints a new password and re-raises `must_change_password`.
- Staff sign in with a **username**, not an email. `lib/credentials.ts` is the single module that builds the synthetic login address; a second implementation of it will disagree with the first and nobody will be able to explain why one person cannot sign in.
- The **forced-password-change gate lives in the proxy**, not on a page. A page-level check is bypassed by deep-linking to any other route. Three exemptions and no more: `/change-password`, `/reset-password/*`, `/access-denied`.
- The **only email this product sends is a password reset**. Its base URL comes from `APP_BASE_URL` in server config, never from `Host` or `X-Forwarded-Host` — that is host-poisoning account takeover, and framework origin checks do not save you.

---

## 4. Schema — Phase 0 and 1

Create these via CLI migrations. Enum values are lowercase snake_case.

```
hospitals        id, name, logo_url, address, phone, gstin, settings jsonb, created_at
memberships      id, user_id, hospital_id, role, is_active
                 -- role: super_admin | admin | doctor | front_desk | cashier
                 --       | pharmacist | lab_tech | nurse
                 -- unique(user_id, hospital_id)
                 -- a user may belong to multiple hospitals

departments      id, hospital_id, name, code, is_active
                 -- WHERE somebody sits. Never what they may open.

roles            id, hospital_id, code, name, description, is_system,
                 can_login, legacy_role, created_at, updated_at, deleted_at
                 -- unique(hospital_id, lower(code)) where deleted_at is null
                 -- WHAT somebody does, and therefore what they may open.
                 -- Seeded per hospital by seed_system_roles(), called from
                 -- provision_hospital. is_system roles are renameable, never
                 -- deletable. legacy_role is a temporary bridge to app_role.

role_permissions id, hospital_id, role_id, permission_key
                 -- unique(role_id, permission_key)
                 -- permission_key is plain text: the list of permissions is a
                 -- fact about the CODE (lib/rbac/permissions.ts), not data.

staff            id, hospital_id, user_id (nullable), full_name, role,
                 role_id, department_id, phone, reg_no, consultation_fee,
                 is_active, can_login, employee_code, employment_type
                 -- user_id null = staff record with no login yet
                 -- role is DERIVED from role_id by trigger. Do not write it.
                 -- can_login: null = follow the role, false = denied. Never true.
                 -- employee_code becomes the stem of the username.
                 -- No `status` column: is_active is the single answer.

staff_shifts     id, hospital_id, staff_id, work_date, status,
                 start_time, end_time, hours, notes, created_by
                 -- unique(hospital_id, staff_id, work_date)
                 -- status: scheduled | present | absent | day_off | leave
                 -- hours is STORED, not derived at read time: shifts are
                 -- edited retroactively and payroll must see what was agreed.

staff_accounts   id, hospital_id, staff_id, auth_user_id, login_email,
                 contact_email, username, role_id, temp_password_issued_at,
                 must_change_password, failed_sign_ins, first_failed_at,
                 locked_until, last_login_at, created_at, created_by,
                 disabled_at
                 -- login_email is synthetic and immutable; contact_email is a
                 -- real mailbox used only for a reset link, never to sign in.
                 -- Revoking access is ONE write: disabled_at.
                 -- The temporary password itself is never stored.

password_reset_tokens
                 id, hospital_id, account_id, token_hash, expires_at,
                 used_at, requested_ip, created_at
                 -- sha256 of a 256-bit value, hash only. RLS on with NO
                 -- policies and no grants: service role only.

patients         id, hospital_id, mrn, full_name, dob, gender, phone,
                 address, created_at, created_by, deleted_at
                 -- unique(hospital_id, mrn); index on (hospital_id, phone)

visits           id, hospital_id, patient_id, visit_no, visit_type,
                 doctor_id, department_id, status, visited_at, created_by
                 -- visit_type: opd | ipd | emergency
                 -- status: waiting | in_consultation | completed | cancelled
                 -- the doctor lives HERE, not on the patient

services         id, hospital_id, name, category, price, tax_rate, is_active
                 -- category: consultation | lab | procedure | bed | pharmacy | other
                 -- this is the charge master; lab and IPD reuse it later

charge_items     id, hospital_id, visit_id, service_id, description,
                 qty, unit_price, amount, tax_rate, source_module,
                 invoice_id (nullable), status, created_by, created_at
                 -- status: pending | invoiced | cancelled
                 -- unbilled charges have invoice_id null

invoices         id, hospital_id, invoice_no, fy, visit_id, patient_id,
                 patient_name_snapshot, invoice_date, subtotal, tax_total,
                 grand_total, status, void_reason, created_by
                 -- status: unpaid | partial | paid | void
                 -- patient_name_snapshot is intentional: names change

payments         id, hospital_id, invoice_id, amount, mode, reference,
                 collected_by, paid_at, is_reversed, reversal_reason

number_series    hospital_id, key, fy, current_value
                 -- primary key (hospital_id, key, fy)
                 -- key: invoice | mrn | visit | token

visit_payment_deferrals
                 id, hospital_id, visit_id, invoice_id, reason,
                 approved_by, created_at
                 -- unique(hospital_id, visit_id)
                 -- Who was let through without paying, and why. NO settled_at:
                 -- whether the money came in is a fact about the INVOICE, and
                 -- a second copy would be one more thing to keep in step.
                 -- PAYMENT DUE is derived, via visit_payment_due().

visit_transfers  id, hospital_id, visit_id, from_doctor_id, to_doctor_id,
                 from_token_no, to_token_no, reason, created_by, created_at
                 -- No unique key on visit_id: a patient can be moved twice.

audit_log        id, hospital_id, table_name, record_id, action,
                 actor_id, before jsonb, after jsonb, at
                 -- table_name 'receipt_print' with action 'insert' is a
                 -- printed receipt, written by log_receipt_print(). A print
                 -- changes no row, so no trigger can see it.
```

### Required RPCs

```
my_access()                                  -> jsonb
  The caller's staff record, role, permission keys and account state, in one
  read. Null when the login has no staff record in the active hospital.

seed_system_roles(p_hospital_id)             -> void
  Creates or tops up the system roles for one hospital. Called from
  provision_hospital, so a new tenant gets them automatically. Idempotent:
  adds new permissions, never removes ones an admin unticked (except on admin).

set_role_permissions(p_role_id, p_keys)      -> void
  Replaces a role's permission list in one transaction.

next_number(p_hospital_id, p_key)            -> text
  Locks the number_series row, increments, returns formatted number.
  Resolves the Indian financial year (Apr 1 – Mar 31) internally.

register_patient_visit(...)                  -> jsonb
  THE register desk, in one transaction: patient + MRN, visit + visit_no,
  the per-doctor token, the invoice + invoice_no, and the payment or the
  deferral. Refuses a null doctor, and refuses a null payment mode unless
  p_deferred. Never raises on a duplicate phone.

transfer_visit(p_visit_id, p_doctor_id,      -> jsonb
               p_reason, ...)
  Moves a waiting visit to another doctor with a new token at the back of
  their queue. The old token is retired, never reused. Reason required.

set_visit_status(p_visit_id, p_status)       -> jsonb
  Moves a visit between waiting / in_consultation / completed WITHOUT
  touching the consultation. The doctor's queue buttons. save_consultation
  cannot stand in for it: that one replaces the vitals it is given, so a
  queue-level call through it would blank the nurse's readings. Cancellation
  is deliberately not reachable here -- it is a front-desk act with a reason.

recent_patients(p_limit)                     -> search_patients row shape
  The resting state of /patients. Search-first is not empty-first: a screen
  that shows nothing until three characters are typed reads as a module with
  no patients in it.

visit_payment_due(p_hospital_id, p_visit_id) -> boolean
  Whether the visit still owes money. SECURITY DEFINER and one bit only, so
  the queue badge is visible to a nurse without opening the invoice to her.

log_receipt_print(p_invoice_id, p_format)    -> void
  Records a trip to the printer in audit_log.

register_patient(payload)                    -> patient
  Allocates MRN via next_number. Called by register_patient_visit with
  force_create always set; reachable directly only by the service role.

create_visit(payload)                        -> visit
  Allocates visit_no and a per-doctor queue token. Still the emergency path,
  where a patient arrives before anybody knows who will see them.

collect_payment(p_visit_id, p_items, p_mode, p_amount, p_reference)
                                             -> invoice
  Single transaction: create invoice, allocate number, attach charge_items,
  insert payment, set status. This is the ONLY way an invoice is created.

void_invoice(p_invoice_id, p_reason)         -> void
  Sets status = void, releases charge_items back to pending.
  Never deletes.

day_close_report(p_hospital_id, p_date)      -> table
  Collections by payment mode, by staff, by department. Read-only.
```

---

## 5. Auth and RLS

- A Supabase **custom access token hook** injects `hospital_id` and `role` into `app_metadata` on the JWT.
- RLS policies are a coarse safety net only:
  `hospital_id = (auth.jwt() -> 'app_metadata' ->> 'hospital_id')::uuid`
  plus a role check where relevant.
- Fine-grained permission logic lives in server code and RPCs, not in dozens of policies.
- RLS is **enabled on every table**. No table ships without policies.
- The service role key is used only inside trusted server code. Never in a client component, never in `NEXT_PUBLIC_*`.

---

## 6. Directory structure

```
/app
  /(auth)         login, signup, change-password, forgot-password,
                  reset-password/[token], access-denied
  /(app)
    /admin        branding, departments, staff, roles, roster
    /front-desk   register, queue, incomplete (visits needing a doctor)
    /billing      collect, invoices, day-close
    /doctor       queue, consultation
  /print          receipt/[invoiceId] — the one print route, no app chrome
/components
  /ui             shadcn primitives
  /shared         DataTable, PatientSearch, MoneyInput, PrintLayout
/lib
  /supabase       server.ts, client.ts, middleware.ts, admin.ts
  /rbac           permissions.ts (the frozen key union), routes.ts (the two
                  route maps), resolve.ts (my_access -> permission set, shared
                  with the edge proxy), access.ts, landing.ts
  /accounts       provision.ts, sign-in.ts, reset.ts — server only
  credentials.ts        usernames + synthetic addresses, shared client+server
  credentials.server.ts the half that needs crypto.randomBytes
  /schemas        zod schemas — one file per entity, shared client+server
  /rpc            typed wrappers around Postgres functions
  /utils          money, dates, financial-year, age-from-dob
/supabase
  /migrations     timestamped SQL, in git
  seed.sql        demo hospital + catalog + sample patients
/types            generated Supabase types
```

---

## 7. Coding conventions

- Server Components by default. Client Components only where interactivity requires it.
- Mutations go through Server Actions that call RPCs. No `supabase.from(...).insert()` on money or stock tables anywhere.
- Every form validates with a Zod schema imported from `/lib/schemas` — the same schema on client and server.
- Generate types with `supabase gen types typescript` after every migration. Commit them.
- Client-generated UUIDs for new records so writes are idempotent (leaves the door open for offline later).
- Errors surface as user-readable messages. Never swallow an error into a silent no-op.

### UI rules

- **Keyboard-first on front desk, billing, and pharmacy screens.** Full flows must be completable without a mouse: focus lands on the search field on load, Enter advances, Escape closes, visible shortcut hints. Staff type fast and resent mice; this decides whether the software is adopted.
- Data-dense over spacious. These are work screens, not marketing pages.
- Money always right-aligned, always two decimals, always with ₹.
- Destructive actions require a typed reason, not just a confirm dialog.

### Print

- Invoices, receipts, and prescriptions are HTML + CSS `@media print` templates. No Chromium on serverless.
- Three papers, one document, one route (`/print/receipt/[invoiceId]`): **80mm thermal roll** (the default — the printer bolted to the counter), **A5** (the same receipt for a hospital on a laser printer), and **A4** (the full invoice, for anything that leaves the building). The hospital's default is `hospitals.settings.receipt_default`, set at Administration → Hospital settings → Printing.
- The receipt leads with the **token, large enough to read across a waiting room**. No colour, no background fills, no box shadows — a thermal head prints none of them and the receipt comes out grey.
- **Every trip to the printer writes an audit row** via `log_receipt_print`, bound to `afterprint` so Ctrl+P counts too. Reprints are how one payment ends up with two pieces of paper at the counter.
- Hospital name, logo, address, and GSTIN come from the `hospitals` row, never hardcoded.

---

## 8. GST note (India)

Hospital **services** are largely GST-exempt; **pharmacy sales** are taxable. The schema carries `tax_rate` per service and per charge item for this reason. Do not apply a blanket tax rate across an invoice.

---

## 9. Definition of done for any slice

1. Migration committed under `/supabase/migrations`
2. RLS enabled with policies on every new table
3. Zod schema in `/lib/schemas`
4. Types regenerated and committed
5. Seed data covers the new feature
6. Happy path works end to end in the browser
7. One error path handled visibly (duplicate, empty result, failed write)

---

## 10. When in doubt

- If a task would require changing `patients`, `visits`, `invoices`, `payments`, `charge_items`, or `stock_ledger` schema — **stop and ask** before writing the migration.
- If a requirement seems to need a global unique constraint, it's wrong. Scope it to `hospital_id`.
- If a feature is not in the current phase, don't build it. Note it and move on.

Do not add "Co-Author By Claude" ( or any AI co author ) while commit in the github repo. 
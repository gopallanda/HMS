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
- Patients are soft-deleted (`deleted_at`), never hard-deleted.

### 3.4 Stock (Phase 2 — obey when you get there)

- Stock is an append-only `stock_ledger` (batch, expiry, qty_in, qty_out, reason, ref).
- **Never** a mutable `quantity` column on a drug row. Current stock is derived.
- Dispensing is FEFO (first-expiry-first-out).

### 3.5 Audit

- All mutations on `patients`, `visits`, `invoices`, `payments`, `charge_items` write to `audit_log` via a Postgres trigger.
- Nothing in the app hard-deletes a row. Use `deleted_at` or a status column.

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
staff            id, hospital_id, user_id (nullable), full_name, role,
                 department_id, phone, reg_no, consultation_fee, is_active
                 -- user_id null = staff record with no login yet

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

audit_log        id, hospital_id, table_name, record_id, action,
                 actor_id, before jsonb, after jsonb, at
```

### Required RPCs

```
next_number(p_hospital_id, p_key)            -> text
  Locks the number_series row, increments, returns formatted number.
  Resolves the Indian financial year (Apr 1 – Mar 31) internally.

register_patient(payload)                    -> patient
  Allocates MRN via next_number. Fails loudly on duplicate phone
  unless force_create is true.

create_visit(payload)                        -> visit
  Allocates visit_no and queue token. Optionally seeds a consultation
  charge_item from the doctor's fee.

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
  /(auth)/login
  /(app)
    /admin        branding, departments, staff
    /front-desk   register, visits, queue
    /billing      collect, invoices, day-close
    /doctor       queue, consultation
  /api            print/PDF routes only
/components
  /ui             shadcn primitives
  /shared         DataTable, PatientSearch, MoneyInput, PrintLayout
/lib
  /supabase       server.ts, client.ts, middleware.ts
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
- Support 80mm thermal roll and A4 layouts. Thermal is the default for OPD receipts.
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

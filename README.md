# HMS — Hospital Management System

Read [CLAUDE.md](CLAUDE.md) before changing anything. It is the spec, not a
style guide.

Stack: Next.js (App Router) + TypeScript strict, Tailwind + shadcn/ui,
Supabase (Postgres / Auth / Storage / Realtime, region `ap-south-1`), Zod,
TanStack Query.

**Status: Phase 1, in progress.** Login, app shell and the admin module
(hospital settings, departments, staff) are built, so is the patient and visit
layer (registration, the new-visit form, today's queue), so is billing (collect
payment, invoices with void, day close, both print templates), and so is a
minimal doctor module: my queue, vitals, consultation notes, complete. Lab,
pharmacy and IPD appear in the sidebar greyed out, tagged with their phase.

---

## Setup

This project uses a **hosted** Supabase project (region: Mumbai, `ap-south-1`).
There is no local Docker stack.

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` from the Supabase Dashboard:

| Variable | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings -> API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings -> API |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings -> API (secret) |
| `SUPABASE_DB_URL` | Connect -> Direct connection |
| `SUPABASE_ACCESS_TOKEN` | Account -> Access Tokens (only `db:types` needs it) |

`SUPABASE_DB_URL` is used only by `scripts/db.mjs`, never by the app. Use the
direct connection or the **session** pooler — the transaction pooler cannot run
migrations. Percent-encode special characters in the password.

Then:

```bash
npm run db:push:dry   # show what would run
npm run db:push       # apply supabase/migrations
npm run db:seed       # migrations + supabase/seed.sql
npm run db:types      # regenerate types/database.ts from the live schema
```

If the objects already exist on the project but the migration history does not
know it -- an early migration applied by hand, or a history table lost with a
restore -- a push will replay migration 1 and fail on a type that is already
there. Record what is already applied, then push the rest:

```bash
node scripts/db.mjs repair <version> [<version> ...]
```

That writes `supabase_migrations.schema_migrations` only. It never runs or
alters a table.

### One manual step: enable the auth hook

Migrations create `public.custom_access_token_hook`, but SQL cannot switch it
on. Until you do, every JWT is missing `hospital_id` and `role`, and every RLS
policy denies.

1. Dashboard -> **Authentication -> Hooks**
2. **Customize Access Token (JWT) Claims** -> Add hook -> Postgres
3. Schema `public`, function `custom_access_token_hook`
4. Enable and save

Claims are baked in when a token is issued. After enabling the hook — or after
changing anyone's role — that user must sign out and back in before it takes
effect.

### First login

```bash
npm run db:seed
```

The seed creates one hospital, three departments, five staff, and a login:

| | |
| --- | --- |
| Email | `admin@sunrise.test` |
| Password | `Sunrise@123` |
| Membership role | `super_admin` |

**Change that password before anyone real uses this project.** It is in
`supabase/seed.sql` in plain text, on purpose, because it is demo-only.

The login is attached to Dr. Anjali Rao's staff record -- in a hospital this
size the owner is usually one of the doctors. Her *staff* role stays `doctor`
(the job); her *membership* role is `super_admin` (what the JWT carries and
what RLS reads). Those are deliberately different fields.

Creating an auth user means writing into GoTrue's own tables, which is not a
supported API. If it fails, the seed says so and prints the fallback: Dashboard
-> **Authentication -> Add user**, email `admin@sunrise.test`, tick **Auto
Confirm User**, then run `npm run db:seed` again to attach the membership. The
seed is idempotent, so re-running is always safe.

```bash
npm run dev
```

## Working on the database

Schema changes go through the CLI. **Never** the dashboard.

```bash
npx supabase migration new <name>   # creates a timestamped file
npm run db:push:dry                 # review
npm run db:push                     # apply
npm run db:types                    # regenerate types/database.ts -- commit it
```

There is deliberately no `db:reset` script. Against a live project it would
drop the database.

`types/database.ts` is still hand-written, but it is no longer speculative: it
was checked column-for-column against the live schema after the billing
migrations landed, and every table, view, column and enum label matches.
Replace it with generated output when you have a token -- `npm run db:types`
goes through the Management API and needs `SUPABASE_ACCESS_TOKEN`, because the
CLI serves `--db-url` out of a Docker container and this project has none.

**No Docker, ever** (CLAUDE.md 2). There is no local stack and no
`supabase start`. Migrations, seeds and `npm test` run against the hosted
project through `SUPABASE_DB_URL`; type generation goes over HTTPS with
`SUPABASE_ACCESS_TOKEN`. Nothing here starts a container. If that variable is missing, get it
-- do not stand up a local Postgres as a substitute, because a shimmed
database is not the one this code runs on and anything it proves has to be
proved again anyway.

## Layout

| Path                  | What                                                        |
| --------------------- | ----------------------------------------------------------- |
| `app/(auth)/login`    | login page, form, sign-in action                             |
| `app/(app)`           | signed-in shell; `page.tsx` is the overview                  |
| `app/(app)/admin`     | settings, departments, staff                                 |
| `app/(app)/front-desk`| register (search-first), queue (Realtime)                     |
| `app/(app)/billing`   | collect payment, invoices (+ void), day close                |
| `app/(app)/doctor`    | my queue (Realtime), consultation (vitals + notes)           |
| `app/(print)`         | receipt and invoice templates, outside the app shell          |
| `app/api`             | print/PDF routes only                                        |
| `components/ui`       | shadcn primitives                                            |
| `components/shell`    | sidebar, user menu, hospital mark, access denied             |
| `components/shared`   | Field, FormMessage, SubmitButton, MoneyInput, PageHeader     |
| `lib/auth`            | `session.ts` (JWT claims -> context), `actions.ts` (sign out)|
| `lib/nav.ts`          | one table of modules, roles and phases                       |
| `lib/roles.ts`        | role labels and the admin-role check                         |
| `lib/supabase`        | `server.ts`, `client.ts`, `middleware.ts`, `admin.ts`        |
| `lib/schemas`         | Zod schemas, shared client + server                          |
| `lib/patients.ts`     | gender labels, "34 Y / M"                                     |
| `lib/visits.ts`       | visit type and status labels                                  |
| `lib/billing.ts`      | payment modes, invoice statuses, paper sizes, line totals     |
| `lib/consultations.ts`| the six vitals, their units, ranges and display               |
| `lib/rpc`             | typed wrappers around Postgres functions                     |
| `lib/utils`           | money, dates, financial-year, age-from-dob                   |
| `supabase/migrations` | timestamped SQL, committed                                   |
| `types`               | generated Supabase types                                     |
| `tests`               | money tests, run against the hosted database                 |

Two deviations from CLAUDE.md section 6, both forced by tooling:

- **`proxy.ts` at the root.** Next.js 16 renamed the `middleware.ts` root
  convention to `proxy.ts`. `lib/supabase/middleware.ts` keeps its specified
  name and holds the actual session logic; `proxy.ts` is a three-line adapter.
- **`lib/cn.ts`.** shadcn/ui wants its `cn()` helper at `lib/utils`, which
  collides with the `lib/utils/` directory CLAUDE.md defines. `components.json`
  points shadcn at `@/lib/cn` instead, so generated components import from
  there.

## Which Supabase client

| Use                                             | Import                                       |
| ----------------------------------------------- | -------------------------------------------- |
| Server Component, Server Action, Route Handler  | `lib/supabase/server.ts`                     |
| Client Component                                | `lib/supabase/client.ts`                     |
| Session refresh                                 | `lib/supabase/middleware.ts` (via `proxy.ts`)|
| Provisioning, background jobs                   | `lib/supabase/admin.ts` — **bypasses RLS**   |

The first three use the anon key and respect RLS. `admin.ts` does not, is
`server-only`, and every call site must filter by `hospital_id` itself.

## How a request knows which hospital it is in

1. `proxy.ts` -> `lib/supabase/middleware.ts` refreshes the session cookie and
   bounces anyone without one to `/login?next=...`.
2. `lib/auth/session.ts` calls `supabase.auth.getClaims()`, which **verifies**
   the token, and reads `app_metadata.hospital_id` and `app_metadata.role` from
   it. Never a `memberships` lookup: the token is exactly what RLS will enforce
   a moment later.
3. `app/(app)/layout.tsx` calls `requireSession()` once; pages beneath it reuse
   the result (`cache()` dedupes it per request).
4. Every Server Action calls `requireSessionForAction()` **again**, because
   actions answer POSTs directly without passing through any layout.

If the JWT hook is off, sign-in stops with a message naming the hook rather
than dropping the user into an app where every query returns nothing.

## Logo storage

`supabase/migrations/20260818110000_storage_branding.sql` creates a public
`branding` bucket laid out as `branding/<hospital_id>/logo-<timestamp>.<ext>`.
The first path segment is the tenant boundary, and the write policies check it
against the JWT claim -- the same rule as `hospital_id` on a row.

Read is public because logos print on invoices and receipts, and a signed URL
would expire mid print job.

`storage.objects` is owned by `supabase_storage_admin`, so if the migration
role cannot create policies on it the migration prints a warning with the
manual steps instead of failing.

## Numbering

| Number | Comes from | Restarts |
| --- | --- | --- |
| MRN | `next_number(hospital, 'mrn')` | per financial year |
| Visit no | `next_number(hospital, 'visit')` | per financial year |
| Invoice no | `next_number(hospital, 'invoice')` | per financial year |
| Queue token | `max(token_no) + 1` for the hospital's IST day, taken under a per-hospital-per-day advisory lock inside `create_visit` | every day |

The queue token is the one number that does **not** come from `number_series`,
because that table is keyed `(hospital_id, key, fy)` and a token has to restart
every morning, not every April. Uniqueness is enforced by
`visits_hospital_id_day_token_key`, a unique index on
`(hospital_id, ist_date(visited_at), token_no)`.

`ist_date()` applies a fixed +05:30 rather than `at time zone 'Asia/Kolkata'`,
because a unique index needs an IMMUTABLE expression and the timezone database
is not one. India has had no DST since 1945; if that changes, the function and
every index on it have to be rebuilt deliberately.

**One open question, worth a decision before real patients exist:** because
`next_number` resolves the financial year internally, an MRN reads
`MRN/2026-27/00001` and the counter restarts each April. Numbers never collide
(the year is part of the string), but an MRN is normally a lifetime identifier
and hospitals expect it to run continuously. Changing it means giving
`next_number` a per-key rule about whether the year applies -- cheap now, a
data migration later.

## Patient search

The register screen is search-first (CLAUDE.md 3.3): the blank create-form is
the fallback, reached with `F2` or by pressing `Enter` when nothing matched.

`search_patients(query, limit)` matches three ways, each on its own trigram
index: name as a substring, MRN as a substring, and phone compared on **digits
only** -- so a number stored as `+91 98450 11223` is found by typing
`9845011223`, or just the last four digits. It returns nothing below three
characters, because a shorter pattern contains no whole trigram and would scan
the table on every keystroke.

`register_patient` refuses to create a second patient on a phone number that is
already on file, and raises SQLSTATE `90001`. That is a question, not a
failure: Indian families routinely share one mobile. The dialog lists who is
already on that number, and the desk either opens the existing record or
confirms `force_create`.

## Realtime

The queue subscribes to `postgres_changes` on `public.visits`, filtered to its
own `hospital_id`, and calls `router.refresh()` when anything moves -- so the
rows are still rendered on the server, through the same policies as a plain
page load. Realtime only says *something changed*.

`visits` is added to the `supabase_realtime` publication by
`20260818120000_patients_visits_services.sql`. Realtime applies each
subscriber's own RLS, so `visits_select_tenant` is what keeps one hospital's
queue out of another hospital's browser.

The queue reads `visit_queue`, a `security_invoker` view that joins the visit
to its patient, doctor, department and charge total.

The doctor's queue rides the same subscription and the same view, narrowed to
one `doctor_id` and one IST day. `postgres_changes` takes a single filter, so
the channel is filtered to the hospital and the doctor is matched by the query
behind the refresh -- the extra wake-ups cost one cached server render, and
sharing the read model is worth more than the filter.


## Doctor

Two screens, deliberately. Prescriptions and structured history are a later
phase (CLAUDE.md 1), and a half-built version of either is worse than none --
staff start using it and then have to be migrated off it.

`/doctor/queue` is **today's visits booked to the doctor who is signed in**,
ordered by token, live on the same Realtime subscription the front-desk queue
uses. Waiting and with-the-doctor are the queue; completed and cancelled drop
into an "Earlier today" list underneath, because *have I already seen this
patient* is asked constantly and should not need a page reload.

"Mine" is a **staff id, not a user id**: `visits.doctor_id` references `staff`,
because a staff record exists before a login does (CLAUDE.md 4). A login with
no staff record has no queue, and the screen says so rather than showing an
empty table -- attach the login under Admin → Staff and the patients appear.

`/doctor/visit/[id]` is the consultation: patient summary (name, age computed
from `dob`, sex, phone, last ten visits with who saw them), six vitals, and a
free-text note.

| | |
| --- | --- |
| Table | `consultations`, **one row per visit** -- `unique (hospital_id, visit_id)`. Opening the same patient twice edits one record instead of growing a pile of near-identical notes. |
| Vitals | `bp_systolic`, `bp_diastolic`, `pulse`, `temperature_f`, `weight_kg`, `spo2`. Each nullable and independently so: a patient in for a dressing change gets a pulse taken and nothing else. |
| Temperature | Stored in **Fahrenheit**. An Indian OPD chart reads 98.6, not 37, and one stored unit beats a per-row unit column to get wrong. |
| Blood pressure | Two columns, never a `"120/80"` string. `consultations_bp_is_a_pair` refuses half a reading, which is a transcription error rather than a measurement. |
| Ranges | The `CHECK` constraints are typo guards, not clinical opinions -- they reject 1200 for a pulse and accept everything a real patient can present with. |
| RLS | Narrower than `patients` and `visits`: the select policy names the clinical roles. The cashier needs a patient's name for a bill; they have no reason to read what the doctor wrote. |

### One RPC

`save_consultation(payload)` writes the vitals, the notes and the visit's new
status **in one transaction** -- the same rule the money tables follow
(CLAUDE.md 3.2), for a different reason: "saved the notes but the patient still
shows as waiting" is the failure a doctor would never think to check for.
`consultations` has no insert or update policy, so it is the only writer.

* The vitals are **replaced, not merged**. The form always posts all six, so a
  box the doctor cleared has to be able to become null again.
* **Save** moves a `waiting` visit to `in_consultation`. **Save & complete**
  sets `completed`, which is what takes the patient off the queue.
* Re-opening a completed visit to fix a typo never puts the patient back on the
  board -- `in_consultation` only ever moves a `waiting` visit forward.
* A **doctor** may only write on the visits booked to them, or on one nobody
  has been assigned yet (an emergency that arrives before triage). **Nurses are
  deliberately not restricted this way**: taking vitals for whichever doctor is
  running late is the job. The rule needs the visit, not just the role, so it
  lives in the RPC and the screen only mirrors it (read-only banner).


## Billing

Three screens, one rule: **no application code writes a money table.**
`invoices`, `payments` and `charge_items` have no insert or update policy at
all, so a `supabase.from('invoices').insert()` matches zero rows even from the
service role's own code path. Every write goes through a Postgres function that
runs in one transaction (CLAUDE.md 3.2).

| RPC | Does |
| --- | --- |
| `collect_payment` | The only path that creates an invoice. Raises the ad-hoc charges, locks and totals the lines, draws the number, writes the invoice, attaches the lines, records the payment. |
| `void_invoice` | Status to `void` with a typed reason, charge lines released back to `pending`, payments reversed. Never deletes; the number stays consumed. |
| `day_close_report` | Read-only. Totals plus collections by mode, by staff and by department, for one IST day. |

### Collect payment

`/billing/collect` opens on today's visits, with what is still unbilled on
each. Picking one loads its pending charges live -- a lab or a doctor can raise
a charge while the patient is walking to the counter.

Charges come from two places and end up in the same list:

- **already pending on the visit** -- the consultation fee `create_visit`
  raised from the doctor's own fee, anything added since. Untick to leave it
  pending for a later bill; it is not cancelled.
- **added at the counter** from the services master. The rate pre-fills from
  the service and stays editable. The **tax rate does not travel from the
  browser at all** -- `collect_payment` reads it from the service, so a
  discount at the counter cannot quietly change the GST on a pharmacy line
  (CLAUDE.md 8).

The amount pre-fills with the bill total and follows it until somebody types
over it. Zero raises the invoice unpaid; more than the total is refused, because
change handed back across the counter is not a payment and recording it as one
makes the drawer disagree with the day-close report.

Pressing **Paid** creates the invoice and opens the receipt with the print
dialog already up.

### Idempotency, and two cashiers at once

The browser mints the invoice id (CLAUDE.md 7). A double-click, or a resubmit
after the connection drops, sends the same id and `collect_payment` returns the
invoice it already wrote -- it does not bill the patient twice.

Two cashiers billing the *same* visit is the other half of that problem. The
charge lines are locked `FOR UPDATE` before they are totalled, so the second
call waits, then finds the lines already `invoiced` and raises SQLSTATE
`90002`. The screen says so and offers a reload. Nothing is written.

### Voiding

Destructive actions need a typed reason, not a confirm dialog (CLAUDE.md 7).
The reason is required by the form, by the Server Action and by the RPC, and it
is printed on the reprint.

Voiding also **reverses the invoice's payments**. That is not in the one-line
spec in CLAUDE.md, and it is deliberate: without it a cancelled bill leaves its
money in the day-close total and the cashier cannot make the drawer agree with
the screen. Reversing moves no cash -- the refund happens at the counter, and
`payments.is_reversed` is the record that it did.

**Known consequence.** `void_invoice` releases the charge lines back to the
visit so it can be re-billed correctly, which means a voided invoice has no
lines left to reprint. Its stored `subtotal`, `tax_total` and `grand_total` are
untouched, so the reprint shows the correct money with a note where the lines
were, and `audit_log` holds every line as it was. Keeping the detail on the
invoice itself would mean snapshotting the lines onto it -- a schema change,
and CLAUDE.md 10 says stop and ask first.

Who may void: billing staff, not only admins. A same-day correction is the
common case, and an invoice a cashier cannot fix at 9pm is a day that cannot be
closed. Every void is in `audit_log` with the actor and the reason, and shows
on the day-close report. Tighten `assert_billing()` in
`20260819090100_billing_rpcs.sql` if a hospital wants a supervisor for it.

### Day close

`/billing/day-close` is one RPC call, so every section comes from the same
snapshot of the day. Reversed payments are excluded everywhere: a bill voided
after it was paid leaves nothing behind in the totals. The day is the **IST**
calendar day, never the server's.

All four payment modes are returned even at zero, so the sheet has the same
shape every day and an empty row is visible rather than absent.

### Who can see a bill

`invoices` and `payments` are the only tables with a role check in their select
policy: `super_admin`, `admin`, `cashier` -- the same set the sidebar shows
Billing to. In hospitals where reception also takes money, add `front_desk` to
`BILLING_ROLES` in `lib/roles.ts` **and** to the two policies in
`20260819090000_invoices_payments.sql`. Those two places are the whole change.

## Print

HTML plus `@media print`, never a headless Chromium (CLAUDE.md 7). The browser
already has a print engine and it is attached to the printer.

`/print/invoice/<id>` renders one invoice on either paper, from the same data:

| Format | For |
| --- | --- |
| `?format=thermal` | 80mm roll, no margins, continuous length. **Default** for OPD receipts. |
| `?format=a4` | Insurance, reimbursement, a company account. Logo, full line table, amount in words, signature block. |

Without a `format` the hospital's own default is used, from
`hospitals.settings.receipt_default`. `?autoprint=1` opens the print dialog on
arrival -- the collect screen sets it, the invoice list does not.

Hospital name, logo, address and GSTIN come from the `hospitals` row, never
hardcoded. The print routes live in `app/(print)`, outside the app shell, so
no sidebar can end up on the roll.

## Tests

```bash
npm test
```

There is one test file and it is about money:
`tests/collect-payment-concurrency.test.mjs` proves that two concurrent
`collect_payment` calls cannot produce a duplicate invoice number.

It runs against the **hosted** database over `SUPABASE_DB_URL`, with several
real connections, because what is being proved is a property of Postgres --
row locks, transactions and visibility. A mock would only prove the mock
behaves. Without the URL every test skips rather than fails.

Four cases:

| Test | Proves |
| --- | --- |
| a second collection waits for the first | `next_number`'s `SELECT ... FOR UPDATE` serialises allocation -- the second session is observed parked on a lock in `pg_stat_activity`, and gets the *next* number |
| eight simultaneous collections | eight distinct numbers, consecutive with no gaps, and `number_series` agreeing with the invoices written |
| a rolled back collection | the number is returned, not burned. This is the half a Postgres sequence gets wrong, and the reason CLAUDE.md forbids one |
| two cashiers, one visit | the loser is refused with `90002` instead of charging the patient twice |

Everything runs inside a throwaway tenant (`ZZ Test Hospital`) with no
membership pointing at it, wiped before and after each run. The tenant row
itself is reused rather than dropped, because a hospital genuinely cannot be
deleted -- its own audit trigger writes a row referencing it. That is correct
behaviour, so the fixture works with it instead of switching the trigger off.

One thing to keep in mind when extending the fixture: it calls the RPCs as
`select * from public.create_visit(...)`, in FROM, never as
`select (public.create_visit(...)).*`. The second form expands the composite
result by re-evaluating the function once per output column -- one call, one
visit per column -- and on `collect_payment` the second evaluation finds the
lines the first one just invoiced and raises `90002`. Every test in the suite
then fails for a reason that has nothing to do with numbering.

## Keyboard

Work screens are keyboard-first (CLAUDE.md 7). The hints are printed in the
toolbar, not hidden in a help page.

Department and staff tables:

| Key | Does |
| --- | --- |
| `/` | focus the search box |
| `N` | open the new-record dialog |
| `Esc` | close the dialog |
| `Enter` | submit the form |

Register patient -- the whole flow runs without a mouse. Focus lands in the
search box on load:

| Key | Does |
| --- | --- |
| type | search by phone digits, name or MRN (3 characters or more) |
| `↑` `↓` | move through the matches |
| `Enter` | new visit for the highlighted patient, or register when nothing matched |
| `F2` | register a new patient, carrying over whatever was typed |
| `Esc` | clear the search, or close the dialog |
| `Ctrl`+`Enter` | save the open dialog from any field, including a dropdown |

After a visit is created the search box is cleared and refocused, ready for the
next person in line.

Collect payment -- the same shape, and the whole bill can be taken without
touching the mouse. Focus lands in the visit search on load:

| Key | Does |
| --- | --- |
| type | filter today's visits by token, name, MRN or phone |
| `↑` `↓` | move through the list |
| `Enter` | open the bill for the highlighted visit |
| `/` | back to the visit search from anywhere |
| `Alt`+`S` | open the charge picker |
| `Alt`+`1` … `Alt`+`4` | cash / UPI / card / other -- works from inside the amount box |
| `Alt`+`A` | focus and select the amount |
| `Ctrl`+`Enter` | take the payment |
| `Esc` | clear the search, then drop the selected visit |

`Alt` is used for the mode keys rather than a bare digit precisely because the
caret is usually sitting in the amount field, where a digit is a digit.

Doctor queue and consultation. The doctor module is not on the keyboard-first
list in CLAUDE.md 7 -- front desk, billing and pharmacy are -- but a queue is a
list, and a list that cannot be walked with the arrow keys needs a mouse for no
reason:

| Key | Does |
| --- | --- |
| `↑` `↓` | move through the queue |
| `Enter` | open the highlighted visit |
| `Ctrl`+`S` | save the consultation without completing it |
| `Esc` | back to the queue |

On the consultation screen the caret lands where the work is: in the notes when
somebody has already taken the vitals -- a nurse before the doctor, which is the
normal shape -- and at the top of the vitals when nobody has.

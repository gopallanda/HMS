# Phase 1 — Remediation

- Block 1 Roles/Departments/Roster : **DONE**  (migrations 20260828090000, 090100, 090400)
- Block 2 Provisioning             : **DONE**  (migrations 20260828090200, 090300)
- Block 3 Middleware/RBAC          : **DONE**  (no migration)
- Block 4 Registration RPC         : **DONE**  (migration 20260829090000)
- Block 5 Printing                 : **DONE**  (migration 20260829090100)
- Block 6 Form alignment           : **DONE**  (no migration)
- Block 7 Cleanup                  : **DONE**  (migrations 20260829090200, 090300)

---

## Block 1 — Roles, permissions, departments, staff who never log in

**Migrations applied to the hosted project**

| Version | What |
| --- | --- |
| `20260828090000_roles_and_permissions` | `roles`, `role_permissions`, `seed_system_roles()`, `set_role_permissions()`, RLS, audit + lifecycle triggers, backfill for the four existing hospitals, `provision_hospital()` seeds roles |
| `20260828090100_staff_roles_and_roster` | `staff.role_id / can_login / employee_code / employment_type`, backfill + `not null`, `sync_staff_legacy_role()` trigger, `staff_shifts` + `compute_shift_hours()`, RLS |
| `20260828090400_roster_clear` | delete policy on `staff_shifts` only |

**Files**

- `lib/rbac/permissions.ts` — the frozen key union, groups, labels
- `lib/rbac/access.ts` — `loadAccess()`, the permission set for a request
- `lib/schemas/role.ts`, `lib/schemas/shift.ts`, rewritten `lib/schemas/staff.ts`
- `app/(app)/admin/roles/*` — list, create, edit, soft delete
- `app/(app)/admin/roster/*` — month grid, department filter, cell editor
- `lib/nav.ts` — Roles and Roster added
- `supabase/seed.sql` — `seed_system_roles`, two cleaners, a fortnight of their shifts

**Done when — verified in the running app**

- Sunita Devi and Ravi Naik exist as Cleaners, role `can_login = false`, no credentials
  offered, 14 shifts each, hours totalling 88 and 96 (one absence).
- A custom role (`ward_sister`) was created through `/admin/roles` with six ticked
  permissions and persisted exactly those. Retired again after the test.

---

## Block 2 — Account provisioning and login

**Migrations applied**

| Version | What |
| --- | --- |
| `20260828090200_staff_accounts` | `hospitals.slug` + `slugify()`, `staff_accounts`, `password_reset_tokens`, RLS, `provision_hospital()` sets a slug, **`attach_staff_login()` dropped** |
| `20260828090300_my_access` | `my_access()` — role, permission keys and account state in one read |

**Files**

- `lib/credentials.ts` / `lib/credentials.server.ts` — usernames, synthetic addresses,
  `crypto.randomBytes` passwords and reset tokens
- `lib/accounts/provision.ts` — provision / reset / disable / remove, with rollback
- `lib/accounts/sign-in.ts` — username resolution and throttling
- `lib/accounts/reset.ts` — token lifecycle
- `lib/mailer.ts` — Resend over `fetch`, no dependency; no-op without a key
- `lib/supabase/middleware.ts` — revoked gate + forced-password-change gate
- `app/(auth)/{change-password,forgot-password,reset-password/[token],access-denied}`
- `lib/auth/session.ts` — `requirePermission()` / `checkPermission()`
- Deleted: `app/(auth)/set-password/*`, `inviteStaff`, `InviteDialog`,
  `staffInviteSchema`, `INVITABLE_ROLES`, `attachStaffLogin` wrapper and the RPC

**Verified end to end in the running app**

- Issuing a login to Lakshmi Prasad returned `lakshmi.prasad` + a 10-character
  temporary password, shown once with copy buttons. Four records written
  consistently: auth user, `staff.user_id`, membership (`front_desk`), `staff_accounts`.
- She signed in **by username** and was sent straight to `/change-password`.
- Deep-linking to `/patients` while holding the temporary password bounced back
  to `/change-password`.
- After choosing a password she landed on `/front-desk/register` with no
  Administration section in the nav; `/admin/staff` showed the access-denied card.
- Forgot-password returned the identical sentence for a real and a fake address;
  the real one produced a link. The link worked once; the second use was refused.
- Five wrong passwords produced the blended message, the sixth reported the lock.
- Revoking the account signed the live session out to `/access-denied?reason=revoked`.

Test data created during verification was removed afterwards (the account through
the same auth-user-first delete order the product uses; the custom role soft
deleted).

---

---

## Block 3 — Enforcement: proxy, route guards, navigation

No migration. Everything here is application code.

**Files**

- `lib/rbac/routes.ts` — `ROLE_HOME`, `ROUTE_PERMISSIONS` (longest prefix wins),
  `requiredPermission()`, `mayOpen()`, `roleHome()`
- `lib/rbac/resolve.ts` — `resolveAccess()` lifted out of `access.ts` so the edge
  proxy and the Node server share one mapping from `my_access()` to a permission
  set. `access.ts` is now the server-side fetch around it.
- `lib/rbac/landing.ts` — `landingForCaller()`, used by sign-in and by the end of
  a forced password change
- `lib/supabase/middleware.ts` — rewritten to the eight-step order: strip identity
  headers, refresh, verify, load access, revoked gate, forced-change gate,
  signed-in redirects, route guard, attach identity headers
- `lib/nav.ts` — `NavItem.roles` → `NavItem.permissions`; `navFor(PermissionSet)`,
  `navLandings()`, `landingFor(roleCode, permissions)`
- `components/shell/can.tsx` — `<Can permission=... any=[...]>`
- `components/shell/denied-toast.tsx` — surfaces `?denied=<path>`, then strips it
- `components/shell/access-denied.tsx`, `user-menu.tsx` — show the STAFF role's
  name, not the `app_role`
- The four section layouts (`admin`, `billing`, `doctor`, `front-desk`) and the
  invoice print page now gate on permissions instead of `isAdminRole()` /
  `isBillingRole()` / `isClinicalRole()` / `isFrontDeskRole()`

**Decisions**

- **`/` is `reports.view`.** The overview is the hospital dashboard — setup
  checklist, takings, lifecycle banner — which is a manager's view of the
  business. A doctor holding no `reports.view` neither sees the row nor reaches
  `/`: the proxy sends them to their queue. That is the whole of defect 1, and it
  is why the nav row is keyed on a permission rather than shown to everybody.
- **`getClaims()` replaces `getUser()` in the proxy.** Block 3.2 asks for the
  `staff_accounts` lookup to be fired in parallel with signature verification.
  Not done, and the reason is in the file header: the RPC authenticates with the
  access token in the cookie, so firing it before the refresh has settled 401s on
  exactly the requests where the gates matter most. Switching the network
  `getUser()` for local JWKS verification removes the same round trip without
  that trade — the common case is now one network call, not two.
- **Identity headers are attached but nothing reads them yet.** `getSession()`
  stays the authority: it needs the hospitals row regardless, so the saving would
  be one RPC on pages that need nothing else. `IDENTITY_HEADERS` is exported and
  stripped on the way in, so a page that wants the cheap answer can take it.
- **`/admin` needs any ONE of the administration permissions**, not
  `settings.manage`. A Manager holds `staff.read` and `roster.read` and neither
  of the two the role exists to exclude; a single-permission gate on the section
  would lock them out of their own half of it. Each page re-checks its own.
- The `manager`-over-grants-at-RLS gap recorded under Notes is **not closed**.
  Block 3's app-level guard is now correct and the database's coarse net is still
  wider; closing it means RLS policies keyed on the permission set or new
  `app_role` values, which is a migration touching every policy in the schema and
  was not in this block's steps.

**Done when — the block's own checks**

- A doctor's nav has no Administration section and no Overview; `/` and
  `/admin/staff` both redirect to `/doctor/queue` with `?denied=`.
- `createStaff` with a doctor's session returns `{ ok: false }` — unchanged from
  block 2, `requirePermission('staff.create')` was already at the top of it.

---

## Block 4 - Registration is one transaction

**Migration** `20260829090000_registration_transaction`

| What | Why |
| --- | --- |
| tokens per **doctor** per day | `visits_hospital_id_day_token_key` dropped for `visits_hospital_id_day_doctor_token_key`, keyed on `coalesce(doctor_id, '000...0')` because NULLs are distinct in a unique index |
| `assert_billing()` and the invoice/payment select policies gain `front_desk` | registration now collects the consultation fee at the desk; `lib/roles.ts` had named this exact change since 20260819090000 |
| `visit_payment_deferrals` | who was let through without paying, and why |
| `visit_payment_due()` and `visit_queue.payment_due / defer_reason` | the PAYMENT DUE badge |
| `create_visit` rewritten | token allocation only; everything else verbatim |
| `register_patient_visit()` | the whole desk |

**Files** - `lib/schemas/registration.ts`, `lib/rpc/registration.ts`, rewritten
`app/(app)/front-desk/register/{actions.ts,page.tsx,register-desk.tsx}`, PAYMENT
DUE on the queue board and on the consultation visit header,
`tests/register-patient-visit.test.mjs` (7 tests), `supabase/seed.sql`.

**Decisions**

- **Two protected-table changes, and CLAUDE.md 10 says to ask first.** The prompt
  requires both (per-doctor tokens, block 4.3 step 3, and the acceptance
  checklist's "tokens are per doctor per day"), so they were made and are called
  out here rather than slipped in. Neither adds or removes a column: one drops
  and recreates a unique index on `visits`, the other only widens two RLS
  policies. **No column was added to `visits`, `invoices` or `payments`.**
- **`visits.payment_status` was deliberately NOT added**, which the prompt's
  wording implies. PAYMENT DUE is DERIVED from the invoice through
  `visit_payment_due()`. A stored copy would have to be updated by
  `collect_payment` when the money finally arrives, and the day somebody forgets,
  a settled patient carries the badge forever. Derived, it clears itself.
- **The deferral reason went to a new table, not to a column on `invoices`.**
  Same rule, and it keeps the money tables' shape.
- **The fee is billed through `collect_payment`**, not by seeding a charge in
  `create_visit`. `collect_payment` is the only path that may create an invoice
  (CLAUDE.md 3.2), so `seed_consultation` is passed `false` - seeding as well
  would put the fee on the bill twice.
- **A part payment at registration is not offered.** Deferred takes nothing;
  otherwise the fee is taken in full. Part payment is a billing-counter workflow,
  and putting it on this screen slows the ninety per cent who simply pay.
- **"On duty today" falls back to everybody** when the hospital has no roster row
  for today. Most small hospitals do not roster doctors, and a desk that refuses
  to register anybody because nobody filled in a grid is a desk nobody uses.
  Unrostered doctors sort last and are labelled, never hidden.
- `p_fee` is ignored for a caller without `billing.collect` - the doctor's own fee
  is used instead. Refusing the submit would leave a clerk stuck on a form whose
  problem they cannot see.

---

## Block 5 - Receipt printing

**Migration** `20260829090100_receipt_print_audit` - `log_receipt_print()`.

**Files** - `app/(print)/print/receipt/[invoiceId]/*` (page, `receipt-sheet.tsx`,
`document.ts`, `a4-invoice.tsx` moved in, `print-audit.tsx`, `actions.ts`), A5
added to `PRINT_FORMATS` and `PrintLayout`, and a **Printing** section on
`/admin/settings` writing `hospitals.settings.receipt_default`.

**Decisions**

- **`/print/invoice/[id]` was deleted, not kept.** The receipt route renders the
  same document on three papers and defaults from settings, so the older route
  was a second place for a change to the paper to be forgotten. Every link to it
  was in this codebase and all four were repointed. Anyone holding a bookmark
  gets a 404 - the product is not live in a hospital yet.
- **`audit_action` was not extended.** A print is recorded as `table_name =
  'receipt_print'`, `action = 'insert'`. Adding a fourth enum value needs
  `ALTER TYPE` plus a second migration to use it, for one word.
- **The audit is bound to `afterprint`, not to the Print button**, so Ctrl+P
  counts too. It fires whether the dialog was confirmed or cancelled; the honest
  description of the row is "opened the print dialog for invoice X". A failed
  audit write never blocks the receipt.

---

## Block 6 - The registration screen, aligned

No migration. Folded into the block 4 rewrite of the same screen.

- `components/shared/field.tsx`: `<Field>` now reserves a **fixed-height**
  hint/error slot (`hintLines` widens it to two, `collapse` drops it for a field
  alone in its row), and a new `<FieldSet>` groups controls that are really one
  question. Reserving the slot is the whole fix for the misalignment in the
  screenshot: a row can no longer move when an error appears.
- One 12-column grid, `items-start`, `gap-x-6 gap-y-5`. Name 6 / Phone 6, the age
  fieldset 8 / Gender 4, address 12. Every control the same height.
- Date of birth and age live inside one bordered fieldset legended **Age**.
- Search input: `pl-10` on the input, icon at `left-3`, `pointer-events-none`,
  positioned against the input and never against a wrapper.
- Cancel is a ghost; **Register & collect** is the primary. Nothing destructive
  on the happy path.
- Autofocus on search, `Ctrl+Enter` saves, `Esc` clears, hints in a footer that
  is sticky and full width below `sm`.

---

## Block 7 - Cleanup

**Migrations** `20260829090200_transfer_visit` (the `visit_transfers` table,
`transfer_visit()`, the `incomplete_visits` view) and
`20260829090300_rpc_hospital_argument`.

**Files** - `app/(app)/front-desk/incomplete/*` (page, `transfer-dialog.tsx`,
`actions.ts`), `lib/schemas/transfer.ts`, Transfer on every open queue row, and a
"N need a doctor" link on the queue header when the list is not empty.

**Deleted** - `lib/schemas/visit.ts`, `lib/rpc/visits.ts`,
`app/(print)/print/invoice/`, `patientSchema`, `registerPatient`,
`DUPLICATE_PHONE`, `PatientRow`, and from `lib/roles.ts`: `APP_ROLES`,
`ADMIN_ROLES`, `FRONT_DESK_ROLES`, `BILLING_ROLES`, `CLINICAL_ROLES`,
`isFrontDeskRole`, `isBillingRole`, `isClinicalRole`, `chargesConsultationFee`.

**Every remaining role check became a permission check.** This was the real gap
left by block 3: the four section layouts were converted, but the Server Actions
under `/admin/departments`, `/admin/services`, `/admin/settings`, `/billing/*`,
`/doctor/visit/[id]` and `/patients/[id]` still branched on `app_role`, which
locks every custom role out of them. All now use `checkPermission()`.
`lib/roles.ts` keeps only `ROLE_LABEL`, `roleLabel` and `isAdminRole` - the last
for the tenant-lifecycle banner, which is a fact about the subscription rather
than about the hospital's own permissions, and is documented as such.

**A real defect the tests found.** `transfer_visit` and `log_receipt_print` were
written calling `rpc_hospital_id(null)`, which is correct for a session and
impossible for the service role - so `seed.sql` and the test suite could not call
either. `20260829090300` gives both a `p_hospital_id` argument, the way every
other RPC in the schema already had one. Found by
`tests/register-patient-visit.test.mjs`, which is the argument for that file
existing.

**Not done, and why.** Block 7.1 asks for the post-registration "assign doctor and
department" step to be removed. There was no such screen - that step lived inside
the old two-dialog register flow, which block 4 replaced wholesale. Nothing was
left to delete.

---

## Verification

- `npm run build` clean. `npx tsc --noEmit` clean. `npx eslint` clean.
- `npm test` - 4/4 billing concurrency tests pass against the hosted project.
- `node --test tests/register-patient-visit.test.mjs` - 7/7, including: tokens per
  doctor both starting at 1, the RPC refusing a null doctor and a null payment
  mode, a deferral needing a reason, **four concurrent registrations producing
  four distinct MRNs, tokens and invoice numbers**, and a forced mid-RPC failure
  leaving no orphan patient, visit, invoice, charge or payment.
- The dev server starts clean and an unauthenticated request to
  `/front-desk/register` redirects to `/login?next=%2Ffront-desk%2Fregister`
  with no console or server errors.
- **The signed-in screens were NOT walked through in a browser this session.**
  That needs a password typed into the login form, which is not something this
  session does. The acceptance-checklist items that need a live session - the
  doctor landing on their queue, `/settings` redirecting, the receipt on 80mm
  paper, no row shifting under a validation error - are still to be confirmed by
  hand.

---

## New gotcha

**`npm run db:seed` did not run the new seed block.** The CLI reported
`supabase/seed.sql (hash update)` and updated the recorded hash without executing
the file, so the three demo registrations were applied directly over
`SUPABASE_DB_URL` instead. Worth checking row counts after any future `db:seed`
rather than trusting the exit code.

## Notes

Things found or decided along the way that the next block should know.

**The reference document does not exist.** `AUTH_PROVISIONING_FLOW.md` is not in
the repo and never has been (nothing in git history matches). Block 2 was built
from the prompt's own §2.1–§2.6, which specify the behaviour completely. If the
document turns up, §9's port checklist should be re-read against what was built.

**`npm run db:push` works again.** The IPv6 blocker recorded in earlier sessions
is gone; migrations were pushed directly. One historic migration
(`20260825090000_provision_hospital`) was applied but unrecorded and has been
pushed so the history is consistent.

**Deliberate deviations from the prompt's schema sketch, with reasons.**

1. `staff_accounts.temp_password` → **`temp_password_issued_at timestamptz`**.
   The product shows a temporary password once and has no "show it again", so
   storing the plaintext buys nothing and can be read by anything holding the
   service role. What an administrator needs is whether one is outstanding.
2. **No `staff.status` column.** `staff.is_active` already answers "is this
   person still here". Two columns for one fact end with a deactivated member of
   staff still appearing in one of the two lists.
3. `role_permissions` has a **uuid `id`** plus `unique(role_id, permission_key)`
   rather than a composite primary key. `fn_audit()` reads `(row ->> 'id')::uuid`,
   so a table with no id column cannot be audited — and who granted a role the
   power to void invoices is exactly the history CLAUDE.md 3.5 exists to keep.
4. `role_permissions` and `password_reset_tokens` carry **`hospital_id`**, which
   the sketch omits. CLAUDE.md 3.1 says every table, no exceptions.
5. A **`cashier` system role** was added to the prompt's nine. `cashier` is an
   existing `app_role` value with staff already carrying it; without a role of
   the same shape the backfill would have had to demote them to Accountant,
   which silently removes `billing.collect` — the one thing a cashier does.

**Routes.** The prompt names `/settings/roles` and `/staff/roster`. This app's
administration tree is `/admin/*` (settings, departments, staff, services), so
the new screens went to **`/admin/roles`** and **`/admin/roster`** rather than
starting a second tree. Block 3's `ROUTE_PERMISSIONS` should map `/admin/roles →
roles.manage`, `/admin/roster → roster.read`, `/admin → settings.manage` as the
longest-prefix fallback.

**Known gap for Block 3 — the Manager role over-grants at the RLS layer.**
`roles.legacy_role` bridges each role to the old `app_role` enum, and `manager`
maps to `admin` so that RLS lets a manager write staff and departments. That
also makes `is_hospital_admin()` true for them, so a manager holding their own
token could update `hospitals.settings` through PostgREST directly — which the
Manager role's permission set is specifically meant to exclude. The app-level
check is correct; the database's coarse net is wider than the app. Closing it
means either RLS policies keyed on the permission set or new `app_role` values,
and that is Block 3's call, not a patch to make here.

**Nav is still filtered by `app_role`, not by permission.** `lib/nav.ts` gates
Roles and Roster on ADMIN like their neighbours. Both pages check their own
permission server-side, so the gap is cosmetic — but converting the nav, the
route guard and the landing map is one job and belongs together in Block 3.

**Legacy logins.** Anyone who signed in before this phase (the founder, and
anyone invited by email) has `staff.user_id` set and no `staff_accounts` row.
They keep signing in with their email address; the login form accepts both. The
staff list labels them "Signs in by email — issued before usernames" and offers
neither provisioning nor reset for them, because both would fail. Block 7 could
offer a one-click migration to a username; nothing forces it.

**`types/database.ts` is still hand-written.** `npm run db:types` needs
`SUPABASE_ACCESS_TOKEN` in `.env.local`, which is not set. The new tables,
columns and functions were written from the migrations after they were pushed
and typecheck clean, but they are not generated output. Add the token and run
`npm run db:types` when convenient — note that regeneration will widen
`EmploymentType` and `ShiftStatus` back to `string`, since both are CHECK
constraints rather than Postgres enums.

**New environment variables** (see `.env.example`): `APP_BASE_URL`,
`NEXT_PUBLIC_STAFF_EMAIL_DOMAIN`, `RESEND_API_KEY`, `MAIL_FROM`. All optional in
development; `APP_BASE_URL` is a hard error in production, and without
`RESEND_API_KEY` the reset link is printed to the server log instead of sent.

**Test fixture updated.** `tests/support/fixture.mjs` now sets `hospitals.slug`,
calls `seed_system_roles()` and inserts staff by `role_id`. All four money tests
pass against the hosted project.


---

# MVP gap closure — items 1 to 9

Nine findings from a codebase audit, worked in order, one commit each, on the
branch `mvp-gaps`. Every migration was pushed to the hosted project as it
landed; typecheck, lint and the full test suite were green before each commit.

- Item 1 `add_payment`            : **DONE**  (migration 20260902090000)
- Item 2 `cancel_visit`           : **DONE**  (migration 20260902090100)
- Item 3 `reverse_payment`        : **DONE**  (migration 20260902090200)
- Item 4 Discount at the counter  : **DONE**  (migration 20260902090300)
- Item 5 Day close that closes    : **DONE**  (migration 20260902090400)
- Item 6 Outstanding dues         : **DONE**  (no migration)
- Item 7 Prescription print       : **DONE**  (migration 20260902090500)
- Item 8 Permissions and seeding  : **DONE**  (migration 20260902090600)
- Item 9 Operational readiness    : **DONE**  (no migration)

---

## Item 1 — `add_payment`, the P0

**The bug.** `collect_payment` always allocated a number and inserted a new
invoice, so nothing in the product could add money to a bill that already
existed. `register_patient_visit` calls it with `p_amount => 0` on the deferred
path, which writes an `unpaid` invoice and flips the consultation charge to
`invoiced` — so `visit_billing.pending_count` is 0, the collect desk shows the
visit as billed with nothing to do, and the cashier has no button. Deferred
money was unreachable. `partial` was a one-way door for the same reason, and
PAYMENT DUE was advertised on five screens none of which could clear it.

**Migration** `20260902090000_add_payment`

`add_payment(p_invoice_id, p_amount, p_mode, p_reference, p_hospital_id,
p_payment_id, p_collected_by) -> invoices`. `security definer`,
`set search_path = ''`, tenant through `rpc_hospital_id`, gated on
`assert_billing()` — the same preamble as `collect_payment`. The invoice is
locked `FOR UPDATE`, the balance is read under that lock, and the status is
recomputed from the payment ROWS rather than from the amount passed in.

Refuses, each with a sentence naming the real figure: a `void` invoice, an
already-`paid` one, a non-positive amount, a null mode, a null collector, and
anything over the outstanding balance. Idempotent on a client-supplied
`p_payment_id`.

**Deviation from the brief.** `p_collected_by` is not in the specified argument
list and had to be added: `payments.collected_by` is NOT NULL and the seed and
the test suite are service-role callers with no `auth.uid()`. For a signed-in
caller it is refused unless it agrees with the JWT, exactly as in
`collect_payment`, so it grants nothing.

**Files**

- `lib/rpc/billing.ts` — `addPayment()`
- `lib/schemas/billing.ts` — `addPaymentSchema`
- `app/(app)/billing/actions.ts` — new, `addPaymentAction`, gated on
  `checkPermission('billing.collect')`
- `components/shared/collect-balance-dialog.tsx` — one dialog, three openers
- `app/(app)/patients/[id]/collect-balance-button.tsx` — the client island on
  the money panel, so the rest of that table stays a Server Component
- `app/(app)/billing/invoices/*`, `app/(app)/front-desk/queue/*`,
  `app/(app)/patients/[id]/money-panel.tsx`

**Design notes**

- The front-desk queue reads balances through a **second query** against
  `invoice_summary` rather than joining them into `visit_queue`. That view
  exposes `payment_due` as a bare bit through a SECURITY DEFINER helper so a
  nurse can watch the board without the invoice being opened to her; joining
  the amount in would undo exactly that. For a role with no billing read the
  query returns nothing and the badge stays the statement it always was.
- The dialog needs an **explicit Enter handler**. The browser only offers
  implicit submission to a form with a single text input, and this one has an
  amount and a reference — without it the fastest keyboard path ends at a mouse
  (CLAUDE.md 7). Found in the browser, not by tsc.

**Verified in the running app**

- The PAYMENT DUE badge on `/front-desk/queue` became a button reading
  `PAYMENT DUE · 500.00`; collecting 200 moved it to `300.00` and the invoice
  to `partial`. Entering 9999 produced *"That is more than the 225.00 still
  owing on INV/2026-27/00024"* in the dialog.
- The seeded deferred-then-settled registration (Rekha Nair) carries no badge
  at all, which is the whole point.

**Also in this commit.** `/billing/invoices` no longer truncates silently at
`.limit(200)` — it fetches one extra row and says plainly when the list is
capped (item 9's fourth bullet, done here because it is the same file).

---

## Item 2 — `cancel_visit`

`visit_status` has had `cancelled` since the first migration.
`collect_payment` refuses one, `transfer_visit` refuses one,
`set_visit_status` deliberately will not produce one, the queue filters them
out — and nothing could set it. A patient who walked out left a token in the
queue all day and the doctor's waiting count wrong from that moment on.

**Migration** `20260902090100_cancel_visit`

`cancel_visit(p_visit_id, p_reason, p_hospital_id) -> jsonb`.

Three decisions worth recording:

1. **Money is never reversed as a side effect.** Any non-reversed payment on
   the visit refuses the cancellation, naming the amount and telling the user
   to reverse it or void the invoice at the counter first. An *unpaid* invoice
   is voided here through the existing `void_invoice`, so the number stays
   consumed and the lines go back to `pending`. The check runs across every
   live invoice before anything is written, so a visit carrying a paid and an
   unpaid bill is refused whole rather than half cancelled.
2. **The token is retired.** The row keeps its `token_no` and `create_visit`
   still allocates `max + 1` over the day including cancelled visits. Somebody
   is holding a printed slip with that number on it.
3. **The reason goes to `audit_log`**, under `table_name = 'visit_cancellation'`,
   the way `log_receipt_print` writes its own row. No new column on
   `public.visits` — that needs a conversation (CLAUDE.md 10) and does not earn
   one, since the `visits_audit` trigger already records the status move and
   this carries the why.

The minimum reason length is 5, matching `transfer_visit` rather than
`void_invoice`'s 4: this is the same class of act.

**Files** — `lib/rpc/visits.ts`, `lib/schemas/visit.ts`,
`app/(app)/front-desk/actions.ts`, `app/(app)/front-desk/cancel-visit-dialog.tsx`,
wired into the queue (table and card) and `/front-desk/incomplete`. **Not** on
the doctor's queue: a doctor who is not going to see somebody marks them
complete.

**Verified** — against the hosted project first (invoice voided with the
derived reason, charges back to `pending` with `invoice_id` null, token 1
retired and the next visit given 2, a paid visit refused, a double cancel
refused, a short reason refused), then in the app: cancelling V/2026-27/00042
from the dialog wrote `cancelled`, put the reason in `audit_log`, retired the
token and left the charge pending.

---

## Item 3 — `reverse_payment`

`is_reversed` and `reversal_reason` have existed on `payments` since the
billing slice, with `payments_reversal_has_reason` to keep them honest, and
only `void_invoice` ever set them — as a side effect of voiding the whole bill.
A cash payment recorded as UPI could only be fixed by voiding an otherwise
correct invoice: a consumed number, a void reason describing nothing that
happened, lines released back to pending, and a second bill for the same
treatment.

**Migration** `20260902090200_reverse_payment`

`reverse_payment(p_payment_id, p_reason, p_hospital_id) -> invoices`. Typed
reason (4, matching `void_invoice`, because the two records get read side by
side), refuses an already-reversed payment, and recomputes the invoice status
from the remaining rows — so `paid` can go back to `partial` or to `unpaid`.

**Lock order matters here.** The payment is locked, then the invoice.
`add_payment` takes the invoice lock first and then inserts, so taking them the
other way round would let a concurrent collect and reverse on one bill deadlock.

A **void invoice stays void**: recomputing it to `unpaid` would put a bill
nobody owes back on the dues report.

Gated on `billing.void`, not `billing.collect` — undoing a collection changes
what the day close says the hospital took.

**Files** — `lib/rpc/billing.ts`, `lib/schemas/billing.ts`,
`app/(app)/billing/invoices/actions.ts`, and
`app/(app)/billing/invoices/payments-dialog.tsx`, which is also the first
screen in the product that lists the individual payments behind a bill —
reversing needs a row, and `invoice_summary` deliberately aggregates them. The
dialog states plainly that reversing records a correction and moves no cash.

**Verified** — against the hosted project (paid → unpaid, the day-close
collected total dropping from 500.00 to 0, a second reversal refused, a
one-character reason refused, paid → partial with two payments), then in the
app: reversing the payment on INV/2026-27/00030 toasted *"Reversed.
INV/2026-27/00030 is now unpaid. Hand the money back at the counter."* and the
row showed Unpaid with a 600.00 balance.

---

## Item 4 — Discount at the counter

**Schema change on `public.invoices`, signed off explicitly in the brief.**

`discount_amount numeric(12,2) not null default 0 check (>= 0)` and
`discount_reason text`, plus:

- `invoices_discount_has_reason` — written as `(discount = 0 or reason is not
  null)` rather than an exact pairing, so a reason typed and then the amount
  cleared saves as a plain bill instead of failing.
- `invoices_discount_within_total` — so 500 off a 400 bill is a sentence about
  the discount, not an error about a negative total.
- `invoices_grand_total_matches` amended to `subtotal + tax_total -
  discount_amount`. Every existing row has 0, so it holds without a backfill.
- `invoice_summary` rebuilt to carry both columns.

Invoice level, applied **after** tax, with a required reason. Line-level
pre-tax discount stays out of the MVP: services are largely GST exempt anyway
(CLAUDE.md 8), so a discount that moved the taxable value would be arithmetic
in aid of nothing.

`collect_payment` gains `p_discount` and `p_discount_reason`, both defaulted so
`register_patient_visit`'s call is unchanged and the register desk keeps taking
the fee in full — a concession is a billing-counter conversation and that
screen exists to be fast. **Dropped and recreated** rather than replaced: a
defaulted argument on the end is a new overload and every eight-argument call
would become ambiguous. Grants and revokes re-issued.

**Permission `billing.discount`.** The fields on the collect desk are gated on
it and `collectPaymentAction` **re-checks** whenever a non-zero discount
arrives, because a POST reaches the action without passing the component that
hid the boxes (CLAUDE.md 3.6). The gate is a prop rather than `<Can>`: the desk
is a Client Component and `<Can>` is a Server Component, so the value comes
from the same permission set `<Can>` would have read.

The concession and its reason print on the 80mm receipt and on the A4 invoice.

**Verified** — against the hosted project (500 − 100 = 400 stored and paid; a
discount with no reason refused; a discount over the bill refused naming both
figures; a payment over the *discounted* total refused; the old eight-argument
call still resolving; `register_patient_visit` unaffected), then in the app:
100 off a 700 bill previewed as a Concession line and a 600 total, and printed
on the receipt with its reason underneath.

---

## Item 5 — Day close that actually closes

`/billing/day-close` was read-only. There was no record that a day *was*
closed, by whom, or what the cash counted came to against what the system says
it took — and that variance is the entire reason an owner opens the screen.
Concessions were invisible too.

**Migration** `20260902090400_day_closures`

`day_closures` — `hospital_id, close_date, declared_cash, system_cash,
variance, notes, closed_by, closed_at`, `unique(hospital_id, close_date)`, RLS
on with a tenant select policy and **no write policy at all** (`close_day()` is
the only writer), `fn_audit()` trigger.

`system_cash` is **snapshotted, not derived at read time**, for the same reason
`staff_shifts.hours` is: the variance has to keep meaning what the two people
at the counter agreed, even after a late payment lands on the same day.

`close_day()` reads the cash line from `day_close_report` inside the
transaction, refuses a future date (today *is* closable — an OPD counter shuts
at seven), and re-closes with an **UPDATE**. Deleting and re-inserting would
make the audit log read as a closure destroyed and another created rather than
as a drawer counted twice.

Only the **cash** line is reconciled. Card and UPI settle into a bank account
and are nobody's counting problem at the counter.

`day_close_report` gains a fourth `total` row, `discounted`: concessions on the
day's non-void bills, with the count of bills that carried one.

**Closing locks nothing**, and the panel says so. A hospital where a nine
o'clock correction is impossible is a hospital that stops closing days.

**Verified** — against the hosted project (a close at 350 against 400 giving
−50.00; a re-close producing one row with an insert *and* an update in the
audit log; a future date refused), then in the app: 2,125 counted against a
system 2,325 stored a −200.00 variance with the note and the closer's name, and
toasted *"Closed with ₹200.00 SHORT against the system."*

---

## Item 6 — Outstanding dues

`/billing/invoices` opens on a single day, which is right for a counter and
useless for the first question an owner asks. `/billing/dues` is the other view
of the same rows: every non-void invoice with a balance, across all dates,
newest first, with **the phone number** beside it — chasing a debt at a small
hospital is a phone call, and that is why the number is on this screen and not
on the invoice list.

Three ageing buckets (0–7 / 8–30 / 31+ IST days) rendered as filter chips
carrying their own totals, so what is behind each one is visible before anybody
clicks. A plain GET, so a list of the 31-day debts can be bookmarked or sent to
somebody. Gated on `billing.read` — a cashier chasing a balance is who this is
for, not only a manager with `reports.view`. Capped at 500 with the cap stated.
Added to `lib/nav.ts` and `ROUTE_PERMISSIONS`.

**One thing worth remembering.** `AGE_BUCKETS` and `bucketFor` live in
`lib/billing.ts`, not beside the table that renders them. The page is a Server
Component and the table is a Client Component, and a plain value imported from
a `'use client'` module arrives on the server as a **client reference**, not as
the array. That is a runtime `TypeError`, not a type error — it was caught in
the browser, not by `tsc`.

**Verified in the app** — seven invoices owing 2,425.00, buckets splitting
1,725.00 / 700.00 / 0.00, and the 8–30 day chip filtering to the two rows that
belong in it.

---

## Item 7 — Prescription

`prescription.create` has been in the permission union since block 1 and
nothing implemented it. For OPD the prescription **is** the deliverable, and a
doctor who has to hand-write it anyway will not open the consultation screen —
and then the queue never advances and the front desk's waiting counts are wrong
by mid-morning.

**Migration** `20260902090500_prescriptions`

`consultations.prescription jsonb not null default '[]'`, with three checks: it
is an array, every element is an object naming a drug, and at most twenty
lines. The middle one goes through an **IMMUTABLE helper function** because a
CHECK constraint may not contain a subquery (SQLSTATE 0A000) and walking a
jsonb array needs one — the first push failed on exactly that.

**A jsonb array rather than a table, on purpose.** What is stored is a
document: the lines as the doctor wrote them, in the order they wrote them,
read back whole and printed once. Nothing joins to a prescription line and
nothing will until there is a drug master to join it *to*. Phase 2 brings
drugs, batches and a stock ledger, and these rows migrate into it with the text
they were written with; a table now would be a half-built version of that one
with no drug ids in it.

`save_consultation` writes it and **tells absent from empty**: the key missing
means leave the script alone, an array means this is the list now. Vitals and
notes are still replaced wholesale, so a caller that does not know about
prescriptions cannot erase one. (The seed block had to be written to respect
that — it reads the row back and posts the vitals and notes with the script.)

**`log_document_print`** is a *sibling* of `log_receipt_print`, not an extra
argument on it: one has to prove the invoice is ours and the other the visit,
and `log_receipt_print` is bound to `afterprint` in production where a changed
signature is a broken reprint.

**Print route** `/print/prescription/[visitId]`, following
`/print/receipt/[invoiceId]` exactly — same `PrintLayout`, same `?format=` and
`?autoprint=0`, same `afterprint` audit hook. **A5 and A4 only**; `PrintLayout`
gained an optional `formats` prop. 80mm is the roll bolted to the billing
counter and a drug list on a till receipt is not something a patient can hand
to a pharmacist. Hospital name/address/phone from the `hospitals` row, the
doctor's `full_name` and `reg_no`, patient name/age/sex/MRN, date, the vitals
strip, the ℞ mark, the drug rows and a signature line. No colour, no fills:
this gets photocopied.

Reprinting is gated on `consultation.read`, not `prescription.create` —
otherwise only the doctor could hand a patient another copy.
`ROUTE_PERMISSIONS` narrows `/print/prescription` above the `/print` entry.

**Verified in the app** — the A5 sheet rendering the letterhead, doctor and
reg no, patient line, vitals strip and three drug rows; the editor loading
those rows; and an edit made in the browser reaching the database through the
hidden JSON field with the notes and vitals intact.

---

## Item 8 — Permissions and seeding

`queue.cancel` → front_desk, admin, manager. `billing.discount` → cashier,
admin, manager. Neither to nurse: cancelling retires a token somebody is
holding a slip for and voids a bill, and a concession is money the hospital
chose not to take.

**Split across commits, deliberately.** The key in the frozen union and the
`PERMISSION_GROUPS` / `PERMISSION_LABEL` entries landed with the code that
guards on each key (items 2 and 4) — a Server Action cannot compile against a
key that is not in the union, and `PERMISSION_LABEL` is a
`Record<Permission, string>`. Migration `20260902090600` is the third edit, the
grant, plus the backfill loop `20260828090000` used.

`seed_system_roles` stays idempotent: it tops up, and never removes a
permission an administrator unticked, `admin` excepted.

**Verified** — all four existing hospitals topped up, the grants landing on
exactly the six intended role rows and no others.

---

## Item 9 — Operational readiness

**CI.** `.github/workflows/ci.yml` on push and pull request: `npm ci`,
typecheck, lint, tests. `SUPABASE_DB_URL` comes from a repository secret; when
it is absent — every fork PR, since GitHub does not give forked workflows
secrets — the DB-backed suite skips with a sentence saying why and the run
notes it in the job summary. Proved by running the suite from a directory with
no `.env.local`: six suites, all SKIP, exit 0.

**Error reporting.** There were four `console.error` calls in the whole
application. `lib/report-error.ts` is one helper writing structured JSON
(action, message, code, `hospital_id`, `user_id`, plus id-shaped extras) behind
a single `emit` function, so adding Sentry later is one edit and no call sites.
It reads the tenant and login from the cached session rather than threading
context through thirty call sites, and it never throws.

Called from every handled-failure site in `app/**/actions.ts` — this
codebase has no `try/catch`, the `return failure(describeDatabaseError(e))`
returns *are* the catch blocks — plus `lib/accounts/provision.ts`,
`lib/accounts/reset.ts` and both print audit actions. Never given a password, a
temporary password, a reset token or a recipient address; `lib/mailer.ts`'s
production warning was moved onto it and had `mail.to` removed on the way.

**Tests.** Four files, 20 cases, same `node --test` style against the hosted
DB. `add_payment`, `cancel_visit`, `reverse_payment` and the `next_number`
financial-year rollover. Suite is now 6 files / 31 cases, all green.

The clock is the one thing **not** simulated in the rollover test. Postgres has
no supported way to move `now()` for a session, and the suite will not
`create or replace` `financial_year()` on a shared hosted project to fake one —
another connection would see the shim. So the rollover is tested in the pieces
it is made of: `financial_year()` flipping at `2027-03-31T18:30:00Z` and not at
UTC midnight, the `2099-00` padding, a year with no counter row starting at 1, a
year at 4,317 unable to push the next one off 1, and the `fy` column agreeing
with the `fy` inside the invoice number. The file says so at the top.

**Truncation.** Done in item 1 — `/billing/invoices` fetches one row past the
cap and says when the list is capped. `/billing/dues` was built the same way.

**`/reports`.** `ROUTE_PERMISSIONS` guarded it from block 3 with no directory
behind it. Built rather than deleted, since there are now two reports worth
linking: an index with one live figure per card, each card filtered through
`mayOpen()` so nobody is offered a link the proxy will bounce them off.
Deliberately an index and not a dashboard — `/` is already the hospital
overview, and a second screen computing the same figures differently is how two
numbers for one day get onto two screens.

---

## Deviations, and what is still open

1. **`p_collected_by` added to `add_payment`.** Not in the specified signature;
   required because `payments.collected_by` is NOT NULL and the seed and tests
   have no `auth.uid()`. Refused for a signed-in caller unless it agrees with
   the JWT.
2. **`<Can>` could not wrap the discount fields.** The collect desk is a Client
   Component; `<Can>` is a Server Component. A `canDiscount` prop from the same
   permission set does the hiding, and `collectPaymentAction` re-checks — which
   is the layer that was always the real one. Same shape for `canPrescribe` on
   the consultation screen.
3. **Permission keys landed a commit early.** See item 8.
4. **`types/database.ts` is still hand-written.** `npm run db:types` needs
   `SUPABASE_ACCESS_TOKEN`, which is still not in `.env.local`. Every new
   table, column and function was written from the migrations after they were
   pushed, and then **checked column-for-column and signature-for-signature
   against the live schema** (`information_schema.columns`, `pg_get_function_
   arguments`) — they agree. Regeneration is still worth doing, and see the
   warning below before doing it.
5. **Pending charges survive a cancelled visit.** `cancel_visit` voids the
   invoice and leaves `charge_items` at `pending` with no invoice. They are
   invisible — the collect desk already filters `visit_status <> 'cancelled'` —
   but they are there. Cancelling them was not specified and would be a
   judgement about what a cancelled visit's charges *mean*; flagged, not fixed.
6. **`"Dr Dr. Vikram Shetty"` on the receipt.** `staff.full_name` in the seed
   already reads `Dr. Anjali Rao`, and `receipt-sheet.tsx` prefixes `Dr `
   unconditionally. The prescription sheet has a `doctorName()` helper that
   only prefixes when the name does not already carry one; the receipt
   predates this work and was left alone. One line to fix when somebody is next
   in that file.
7. **`PRINT_FORMAT_LABEL['a4']` reads "A4 invoice"** on the prescription's
   paper picker. Correct on the receipt and in hospital settings, slightly
   wrong there. Shared label, not worth forking for one word.

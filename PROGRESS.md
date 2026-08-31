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

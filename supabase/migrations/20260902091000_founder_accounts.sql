-- =============================================================================
-- 20260902091000_founder_accounts.sql
-- What login_email actually means, now that founders have account rows.
--
-- COMMENTS ONLY. No column, constraint or policy changes -- deliberately. The
-- fix this belongs to is entirely in TypeScript (lib/accounts/founder.ts), and
-- the table already accepted the row it needed to; what was wrong was that
-- nothing ever wrote one.
--
-- THE DEFECT
--
-- /signup creates an auth user from the founder's own mailbox and then calls
-- provision_hospital(), which writes the hospital, the membership and the
-- founder's staff row. Every other login in this product is created by
-- provisionStaffAccount(), which ALSO writes a staff_accounts row. So a founder
-- was a half-provisioned member of staff, and four things did not work for
-- them: /forgot-password (requestPasswordReset matches on
-- staff_accounts.contact_email, matched nothing, and returned silently while
-- the form promised a link), the sign-in lockout, revocation through
-- disabled_at, and any account state at all on the staff list.
--
-- WHY login_email IS NOT ALWAYS SYNTHETIC
--
-- The comment written in 20260828090200 said "synthetic and immutable", which
-- was true of every row that existed at the time. It is not the column's real
-- meaning: the column is the address Supabase Auth signs this account in with.
-- For desk-provisioned staff that is synthetic, because a ward nurse has no
-- mailbox and the whole invitation flow died on the assumption that she does.
-- For a founder it is their own address, which is already on their auth.users
-- row and is the credential they have been using since the day they signed up.
-- Minting a synthetic address for them would mean CHANGING their auth email --
-- breaking a working credential to satisfy a naming convention.
--
-- The immutability half still holds for both: nothing in the product updates
-- this column, and a change to it would orphan the login.
-- =============================================================================

comment on column public.staff_accounts.login_email is
  'The address Supabase Auth signs this account in with. Synthetic for staff provisioned at the desk (username@<hospital-slug>.staff.<domain>, never shown to them, never receives mail); the founder own mailbox for an account created through /signup, because that is already their auth.users email. Immutable either way: changing it orphans the login.';

comment on column public.staff_accounts.contact_email is
  'The real mailbox. Recovery only, never a login. Required at creation so an account can recover itself without an administrator. For a founder it equals login_email, which is correct rather than a shortcut -- it is a genuine mailbox, and that is the only thing this column is for.';

comment on table public.staff_accounts is
  'One row per login. Revoking access is one write: disabled_at. Written in exactly two places, both server-only: provisionStaffAccount() for staff, and ensureFounderAccount() for whoever created the hospital through /signup. Never from the client.';

-- =============================================================================
-- 20260921090000_signin_throttle_and_payment_due_scope.sql
--
-- Two defects from the Phase 1 audit. Different screens, same shape: a rule
-- that is written down in one place and checked somewhere it cannot be
-- enforced.
--
--   1. record_failed_sign_in -- the lockout counter was a read-modify-write
--      over PostgREST, which is not a lockout at all under concurrency.
--   2. visit_payment_due     -- the only tenant-scoped RPC in the schema that
--      believed its p_hospital_id argument instead of checking it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. THE SIGN-IN THROTTLE, COUNTED UNDER A LOCK
--
-- lib/accounts/sign-in.ts counted failures like this:
--
--     select failed_sign_ins from staff_accounts where id = $1;   -- reads 0
--     update staff_accounts set failed_sign_ins = <that + 1> ...; -- writes 1
--
-- Five sequential guesses locked the account, exactly as documented. Fifty
-- PARALLEL guesses each read 0, each computed 1, and each wrote 1 -- so
-- locked_until was never set and the ceiling could be walked straight through
-- by anybody willing to open more than one connection. The throttle existed
-- only against an attacker polite enough to wait their turn.
--
-- The fix is not a bigger number, it is doing the arithmetic where the row can
-- be held: SELECT ... FOR UPDATE, then the update, inside one function and
-- therefore one transaction. Concurrent callers queue on the lock and each one
-- reads the count the previous one wrote.
--
-- The window, the ceiling and the cooldown are arguments with defaults rather
-- than literals, because the constants they mirror live in TypeScript
-- (MAX_FAILED_SIGN_INS, FAILURE_WINDOW_MINUTES, COOLDOWN_MINUTES) and two
-- copies of a number drift. The caller passes its own.
-- -----------------------------------------------------------------------------
create or replace function public.record_failed_sign_in(
  p_account_id       uuid,
  p_window_minutes   integer default 15,
  p_max_failures     integer default 5,
  p_cooldown_minutes integer default 15
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_within   boolean;
  v_failures integer;
  v_first    timestamptz;
begin
  select a.failed_sign_ins,
         a.first_failed_at,
         (
           a.first_failed_at is not null
           and a.first_failed_at > now() - make_interval(mins => p_window_minutes)
         )
    into v_failures, v_first, v_within
  from public.staff_accounts a
  where a.id = p_account_id
  for update;

  -- No such account. Silent, like the TypeScript it replaces: the caller has
  -- already decided not to say whether a username exists.
  if not found then
    return;
  end if;

  -- The window slides forward rather than accumulating for ever. Five wrong
  -- guesses spread over a fortnight is somebody who mistypes, not somebody
  -- attacking, and locking them out on a Monday morning for reasons nobody can
  -- reconstruct is its own outage.
  if v_within then
    v_failures := v_failures + 1;
  else
    v_failures := 1;
    v_first    := now();
  end if;

  update public.staff_accounts a
     set failed_sign_ins = v_failures,
         first_failed_at = v_first,
         locked_until    = case
                             when v_failures >= p_max_failures
                               then now() + make_interval(mins => p_cooldown_minutes)
                             else null
                           end
   where a.id = p_account_id;
end;
$$;

comment on function public.record_failed_sign_in(uuid, integer, integer, integer) is
  'Counts one failed sign-in against an account under a row lock and locks the account when the ceiling is reached inside the window. Atomic: the read-modify-write it replaces let parallel guesses walk through the ceiling.';

-- Service role only. There is no session when this runs -- the caller is
-- anonymous by definition -- so it is reached through the admin client in
-- lib/accounts/sign-in.ts and by nothing else. An authenticated grant would
-- hand any signed-in user a way to lock a colleague out.
revoke execute on function public.record_failed_sign_in(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_failed_sign_in(uuid, integer, integer, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- 2. visit_payment_due, SCOPED LIKE EVERYTHING ELSE
--
-- It was SECURITY DEFINER, granted to authenticated, and filtered on the
-- p_hospital_id it was handed:
--
--     where i.hospital_id = p_hospital_id and i.visit_id = p_visit_id
--
-- Every comparable function in this schema resolves the tenant through
-- rpc_hospital_id(), which returns the JWT claim for a signed-in caller and
-- raises 'cross-tenant access denied' on an argument that disagrees. This one
-- did not, which made it the thing log_receipt_print's own comment warns
-- about: an oracle that says whether an id exists in another tenant, one bit
-- at a time. Two unguessable uuids are needed to ask, so this is a small hole
-- -- but it is a hole in the one rule this schema otherwise keeps perfectly
-- (CLAUDE.md 3.1).
--
-- The visit_queue view calls this per row with v.hospital_id. That keeps
-- working: the view is security_invoker, so its rows have already been through
-- the RLS policy and v.hospital_id is the caller's own claim by construction.
-- A service-role caller has no claim, and rpc_hospital_id returns the argument
-- for exactly that case.
-- -----------------------------------------------------------------------------
create or replace function public.visit_payment_due(p_hospital_id uuid, p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices i
    where i.hospital_id = public.rpc_hospital_id(p_hospital_id)
      and i.visit_id    = p_visit_id
      and i.status in ('unpaid', 'partial')
  );
$$;

comment on function public.visit_payment_due(uuid, uuid) is
  'Whether this visit has an invoice still owing. One bit, readable by any member of the hospital; the amount stays behind the billing policies. The tenant is resolved through rpc_hospital_id, so the argument is checked against the JWT rather than believed.';

revoke execute on function public.visit_payment_due(uuid, uuid) from public, anon;
grant execute on function public.visit_payment_due(uuid, uuid) to authenticated;

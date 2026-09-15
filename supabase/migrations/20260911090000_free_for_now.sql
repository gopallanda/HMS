-- =============================================================================
-- 20260911090000_free_for_now.sql
-- No trial clock, for now. Every hospital is on 'standard' and never expires.
--
-- WHY: there is no subscription model yet, so a trial that ends has nowhere to
-- send the administrator. "Choose a plan" with no plan to choose is a hospital
-- that can no longer register patients for no reason anybody can act on.
--
-- WHAT STAYS: the 'trial' enum value, trial_ends_at, hospital_lifecycle_state()
-- and the write triggers from 20260825140000. Suspension still works, and the
-- day pricing exists the trial comes back by restoring the two defaults below
-- -- no enum or trigger change needed.
-- =============================================================================

-- New tenants: no plan that expires, no end date.
alter table public.hospitals
  alter column plan set default 'standard',
  alter column trial_ends_at drop default;

-- Existing tenants: anyone on a trial -- expired or not -- is moved off it, so
-- a hospital already locked out (the trigger refuses every write) is unlocked
-- by this migration rather than by a support-side update.
update public.hospitals
   set plan = 'standard',
       trial_ends_at = null
 where plan = 'trial';

comment on column public.hospitals.plan is
  'Commercial tier. Only trial expires; every other tier is open ended. Defaults to standard while the product is free (20260911090000).';

-- =============================================================================
-- 20260828090400_roster_clear.sql
-- A delete policy on staff_shifts, and only on staff_shifts.
--
-- CLAUDE.md 3.5 says nothing in this app hard-deletes a row, and every other
-- table keeps that rule: invoices are voided, patients and roles are soft
-- deleted, staff are deactivated. All of those are records of something that
-- HAPPENED, and erasing them destroys history.
--
-- A roster cell is not that. It is a statement about a future or past day, and
-- there are three distinct answers a manager needs: "day off", "absent", and
-- "nothing recorded yet". The third is the absence of a row -- the unique
-- constraint on (hospital_id, staff_id, work_date) makes sure of it -- so
-- without a delete there is no way back from a mis-clicked cell to "I have not
-- decided". A status of 'day_off' left behind by mistake is a payroll error
-- with a straight face.
--
-- The audit trigger fires on delete, so the history is kept where history
-- belongs: in audit_log, with who did it and what the row said.
-- =============================================================================

create policy staff_shifts_delete_admin on public.staff_shifts
  for delete to authenticated
  using (hospital_id = public.app_hospital_id() and public.is_hospital_admin());

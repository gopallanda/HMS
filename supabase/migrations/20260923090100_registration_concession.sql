-- =============================================================================
-- 20260923090100_registration_concession.sql
-- The consultation fee on a registration is the doctor's fee. A reduction is a
-- concession, with a reason, on the invoice.
--
-- WHAT WAS WRONG
--
-- register_patient_visit took p_fee and billed whatever it was given, checking
-- only that it was not negative. The app's gate on that field was
-- `billing.collect` -- in the page (canEditFee) and again in the action -- and
-- every seeded `front_desk` role holds billing.collect, because collecting the
-- fee is what the register desk is FOR. So the gate could never refuse
-- anybody: the price of a consultation was a free-text field for every
-- receptionist, and a 300 rupee fee entered as 100 produced an invoice that
-- says 100, a payment that says 100, and no record anywhere that a concession
-- was given or that anything was unusual.
--
-- That is the exact hole 20260902090300 was written to close. Its header says
-- so: "the only route was editing unit_price on an ad-hoc line at the collect
-- desk, which destroys the one fact worth keeping -- that it WAS a concession,
-- how much, and on whose say-so." It then built discount_amount /
-- discount_reason, wired them into collect_payment, gated them on
-- billing.discount -- and left the price field itself open at both desks. The
-- audited path existed beside the unaudited one.
--
-- THE RULE THIS INTRODUCES
--
-- For a SIGNED-IN caller, p_fee may not disagree with the doctor's own
-- consultation_fee. The staff row is the authority on what a consultation costs
-- (CLAUDE.md 4) and this is where that stops being advice. A reduction goes
-- through p_discount, which:
--
--   * requires a reason, enforced here, again in collect_payment, and again by
--     the invoices_discount_has_reason CHECK constraint;
--   * lands in invoices.discount_amount, so it prints on the bill, totals on
--     the day close, and shows up by name in cash_integrity_report -- which is
--     the whole point: "how much are we giving away" becomes answerable;
--   * is gated on billing.discount in the action, which `front_desk` does not
--     hold by default and `cashier` does.
--
-- Service-role callers (auth.uid() is null: seed.sql, tests, admin scripts)
-- keep the override. They have no session to check a permission against and
-- they are trusted by definition -- the same exemption rpc_hospital_id() and
-- assert_billing() already make.
--
-- WHY A CONCESSION IS NOW OFFERED AT THIS DESK AT ALL
--
-- 20260902090300 deliberately withheld it: "that screen exists to be fast for
-- the ninety per cent who simply pay, and a discount is a billing-counter
-- conversation." The reasoning was right and the conclusion assumed the fee
-- field was not itself a discount channel. It was. Given the choice between
-- taking the capability away from a desk that demonstrably uses it and giving
-- it an audited shape, the second keeps the hospital working. The fast path is
-- untouched: the concession fields are empty, hidden from anybody without
-- billing.discount, and cost zero keystrokes when nobody is giving anything
-- away.
--
-- DROPPED AND RECREATED, not replaced: two defaulted arguments on the end are a
-- new OVERLOAD, and every existing named-argument call would become ambiguous.
-- Same reasoning as 20260902090300. Everything not mentioned above is
-- 20260829090000 unchanged, repeated in full because CREATE FUNCTION takes a
-- whole body.
-- =============================================================================

drop function if exists public.register_patient_visit(
  uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid
);

create or replace function public.register_patient_visit(
  p_hospital_id     uuid    default null,
  p_patient_id      uuid    default null,
  p_patient         jsonb   default null,
  p_doctor_id       uuid    default null,
  p_department_id   uuid    default null,
  p_fee             numeric default null,
  p_payment_mode    text    default null,
  p_deferred        boolean default false,
  p_defer_reason    text    default null,
  p_actor_id        uuid    default null,
  p_visit_id        uuid    default null,
  p_invoice_id      uuid    default null,
  p_discount        numeric default 0,
  p_discount_reason text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hospital_id uuid;
  v_actor       uuid := coalesce(auth.uid(), p_actor_id);
  v_deferred    boolean := coalesce(p_deferred, false);
  v_reason      text;
  v_mode        public.payment_mode;
  v_standard    numeric(12,2);
  v_fee         numeric(12,2);
  v_discount    numeric(12,2);
  v_concession  text;
  v_patient     public.patients;
  v_doctor      public.staff;
  v_service     public.services;
  v_visit       public.visits;
  v_invoice     public.invoices;
begin
  v_hospital_id := public.rpc_hospital_id(p_hospital_id);
  perform public.assert_front_desk();

  -- ---------------------------------------------------------------------------
  -- Idempotency first, before any validation, so a retry returns what was
  -- written even if a rule has changed since. That now includes this
  -- migration's own rule: a form submitted before it landed and retried after
  -- must not start failing.
  -- ---------------------------------------------------------------------------
  if p_visit_id is not null then
    select v.* into v_visit
    from public.visits v
    where v.id = p_visit_id and v.hospital_id = v_hospital_id;

    if found then
      select p.* into v_patient
      from public.patients p
      where p.id = v_visit.patient_id and p.hospital_id = v_hospital_id;

      select i.* into v_invoice
      from public.invoices i
      where i.hospital_id = v_hospital_id and i.visit_id = v_visit.id
      order by i.invoice_date, i.invoice_no
      limit 1;

      return public.registration_result(v_patient, v_visit, v_invoice);
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- The three rules the form cannot be trusted to have applied.
  -- ---------------------------------------------------------------------------
  if p_doctor_id is null then
    raise exception 'Choose a doctor. A visit with no doctor is in nobody''s queue.';
  end if;

  if v_deferred then
    v_reason := nullif(btrim(coalesce(p_defer_reason, '')), '');
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'Say why the patient is being seen before paying.';
    end if;
  else
    if nullif(btrim(coalesce(p_payment_mode, '')), '') is null then
      raise exception 'Record how the payment was made: cash, UPI or card.';
    end if;

    begin
      v_mode := p_payment_mode::public.payment_mode;
    exception when others then
      raise exception 'Payment mode must be cash, UPI, card or other.';
    end;
  end if;

  -- ---------------------------------------------------------------------------
  -- The doctor, and the fee.
  --
  -- The fee is the doctor's own, full stop. p_fee survives only for the
  -- service-role callers that have no session -- seed.sql prices its sample
  -- registrations through it -- and a signed-in caller that disagrees with the
  -- staff row is refused rather than quietly overridden, so the refusal is
  -- something a developer sees rather than something a hospital discovers in
  -- its takings six weeks later.
  -- ---------------------------------------------------------------------------
  select s.* into v_doctor
  from public.staff s
  where s.id = p_doctor_id and s.hospital_id = v_hospital_id;

  if not found then
    raise exception 'That doctor is not on the staff list.';
  end if;
  if v_doctor.role <> 'doctor' then
    raise exception '% is not a doctor.', v_doctor.full_name;
  end if;
  if not v_doctor.is_active then
    raise exception '% is no longer active.', v_doctor.full_name;
  end if;

  v_standard := round(coalesce(v_doctor.consultation_fee, 0), 2);

  if auth.uid() is not null
     and p_fee is not null
     and round(p_fee, 2) <> v_standard then
    raise exception
      'The consultation fee on the bill is %''s own fee of %. Record anything less as a concession, with a reason.',
      v_doctor.full_name, to_char(v_standard, 'FM999999990.00')
      using errcode = '42501',
            hint = 'Give a concession instead, or change the fee on the doctor''s staff record.';
  end if;

  v_fee := round(coalesce(p_fee, v_standard), 2);
  if v_fee < 0 then
    raise exception 'A consultation fee cannot be negative.';
  end if;

  -- ---------------------------------------------------------------------------
  -- The concession.
  --
  -- collect_payment validates all of this again and the CHECK constraint on
  -- invoices validates the pairing a third time. It is repeated here because
  -- the message a clerk reads should name the consultation, not the bill, and
  -- because a concession larger than the fee is worth catching before a number
  -- has been drawn from number_series.
  -- ---------------------------------------------------------------------------
  v_discount   := round(coalesce(p_discount, 0), 2);
  v_concession := nullif(btrim(coalesce(p_discount_reason, '')), '');

  if v_discount < 0 then
    raise exception 'A concession cannot be negative.';
  end if;
  if v_discount > 0 then
    if v_concession is null or length(v_concession) < 4 then
      raise exception 'Say why this concession is being given.';
    end if;
    if v_discount > v_fee then
      raise exception 'A concession of % is more than the consultation fee of %.',
        to_char(v_discount, 'FM999999990.00'), to_char(v_fee, 'FM999999990.00');
    end if;
  else
    -- A reason typed and then the amount cleared is a plain registration.
    v_concession := null;
  end if;

  -- ---------------------------------------------------------------------------
  -- The patient: the one that was chosen, or a new one.
  --
  -- register_patient allocates the MRN from number_series under its own
  -- SELECT ... FOR UPDATE. force_create is always true: a phone number
  -- identifies a household, not a person, and this path never raises 90001.
  -- ---------------------------------------------------------------------------
  if p_patient_id is not null then
    select p.* into v_patient
    from public.patients p
    where p.id = p_patient_id and p.hospital_id = v_hospital_id;

    if not found then
      raise exception 'That patient record no longer exists.';
    end if;
    if v_patient.deleted_at is not null then
      raise exception 'That patient record has been removed.';
    end if;
  else
    if p_patient is null or jsonb_typeof(p_patient) <> 'object' then
      raise exception 'Enter the patient''s details, or choose an existing record.';
    end if;

    v_patient := public.register_patient(
      p_patient
        || jsonb_build_object('hospital_id', v_hospital_id::text)
        || jsonb_build_object('force_create', true)
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- The visit and the token.
  --
  -- seed_consultation is false: the fee is billed below through
  -- collect_payment, which is the only path that may create an invoice
  -- (CLAUDE.md 3.2). Seeding a charge here as well would bill it twice.
  -- ---------------------------------------------------------------------------
  v_visit := public.create_visit(jsonb_build_object(
    'id',                p_visit_id,
    'hospital_id',       v_hospital_id::text,
    'patient_id',        v_patient.id::text,
    'doctor_id',         p_doctor_id::text,
    'department_id',     p_department_id,
    'visit_type',        'opd',
    'seed_consultation', false
  ));

  -- ---------------------------------------------------------------------------
  -- The invoice.
  --
  -- One line, from the charge master, so the GST treatment is the SERVICE's and
  -- not a rate assumed across the bill (CLAUDE.md 8). The concession is applied
  -- after tax, on the invoice, exactly as it is at the billing counter.
  -- ---------------------------------------------------------------------------
  select s.* into v_service
  from public.services s
  where s.hospital_id = v_hospital_id
    and s.category = 'consultation'
    and s.is_active
  order by s.created_at, s.name
  limit 1;

  if not found then
    raise exception 'This hospital has no consultation service on its price list, so the fee cannot be billed. Add one under Administration -> Price list.';
  end if;

  v_invoice := public.collect_payment(
    p_visit_id     => v_visit.id,
    p_items        => jsonb_build_array(jsonb_build_object(
                        'service_id',  v_service.id::text,
                        'qty',         1,
                        'unit_price',  v_fee,
                        'description', 'Consultation - ' || v_doctor.full_name
                      )),
    p_mode         => case when v_deferred then null else v_mode end,
    -- Deferred means nothing was collected. Otherwise what is taken is the fee
    -- less the concession, in full: a part payment at registration is a
    -- billing-counter workflow, and putting it on this screen would make the
    -- fast path slower for the ninety per cent who simply pay.
    p_amount       => case when v_deferred then 0 else v_fee - v_discount end,
    p_reference    => null,
    p_invoice_id   => p_invoice_id,
    p_hospital_id  => v_hospital_id,
    p_collected_by => case when auth.uid() is null then v_actor else null end,
    p_discount        => v_discount,
    p_discount_reason => v_concession
  );

  if v_deferred then
    insert into public.visit_payment_deferrals (
      hospital_id, visit_id, invoice_id, reason, approved_by
    )
    values (v_hospital_id, v_visit.id, v_invoice.id, v_reason, v_actor);
  end if;

  return public.registration_result(v_patient, v_visit, v_invoice);
end;
$$;

comment on function public.register_patient_visit(uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid, numeric, text) is
  'Registration in one transaction: patient (MRN), visit (visit_no + per-doctor token), invoice (number), payment or deferral. The consultation is billed at the doctor''s own fee -- a signed-in caller may not override it -- and any reduction is an audited concession with a reason. The only path the register screen uses.';

revoke execute on function public.register_patient_visit(uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid, numeric, text)
  from public, anon;
grant execute on function public.register_patient_visit(uuid, uuid, jsonb, uuid, uuid, numeric, text, boolean, text, uuid, uuid, uuid, numeric, text)
  to authenticated;

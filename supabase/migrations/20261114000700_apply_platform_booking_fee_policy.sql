create or replace function public.book_patient_token_or_quote_fee(
  p_patient_user_id uuid,
  p_clinic_id text,
  p_doctor_id uuid,
  p_department_id uuid,
  p_patient_name text,
  p_phone_number text,
  p_patient_age integer,
  p_patient_gender text,
  p_day_start timestamptz,
  p_day_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.platform_settings%rowtype;
  v_balance integer;
  v_phone_suffix text;
  v_referral_code text;
  v_existing_token text;
  v_free_reason text;
  v_ticket public.tickets%rowtype;
begin
  select settings.*
    into v_settings
    from public.platform_settings as settings
    order by settings.id
    limit 1
    for share;

  if not found then
    raise exception 'Platform settings are not configured';
  end if;

  select patient.free_tokens_balance
    into v_balance
    from public.patients as patient
    where patient.id = p_patient_user_id
    for update;

  if not found then
    v_phone_suffix := pg_catalog.right(
      '0000' || pg_catalog.regexp_replace(p_phone_number, '[^0-9]', '', 'g'),
      4
    );

    loop
      v_referral_code := v_phone_suffix || pg_catalog.upper(
        pg_catalog.substr(
          pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
          1,
          6
        )
      );

      insert into public.patients (id, referral_code)
      values (p_patient_user_id, v_referral_code)
      on conflict do nothing;

      exit when found;

      select patient.free_tokens_balance
        into v_balance
        from public.patients as patient
        where patient.id = p_patient_user_id
        for update;

      exit when found;
    end loop;

    select patient.free_tokens_balance
      into v_balance
      from public.patients as patient
      where patient.id = p_patient_user_id
      for update;
  end if;

  select ticket.token_number
    into v_existing_token
    from public.tickets as ticket
    where ticket.doctor_id = p_doctor_id
      and ticket.phone_number = p_phone_number
      and ticket.created_at >= p_day_start
      and ticket.created_at < p_day_end
      and ticket.status in ('waiting', 'in-consultation')
    limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'mode', 'duplicate',
      'token_number', v_existing_token
    );
  end if;

  if v_settings.is_globally_free then
    v_free_reason := 'global';
  elsif v_balance > 0 then
    update public.patients as patient
    set free_tokens_balance = patient.free_tokens_balance - 1
    where patient.id = p_patient_user_id
      and patient.free_tokens_balance > 0;
    v_free_reason := 'free_token';
  else
    return pg_catalog.jsonb_build_object(
      'mode', 'payment',
      'platform_fee', v_settings.platform_fee
    );
  end if;

  insert into public.tickets (
    clinic_id,
    doctor_id,
    department_id,
    patient_user_id,
    token_number,
    patient_name,
    phone_number,
    patient_age,
    patient_gender,
    priority,
    status,
    notes,
    booking_fee_paid
  )
  values (
    p_clinic_id,
    p_doctor_id,
    p_department_id,
    p_patient_user_id,
    'T',
    p_patient_name,
    p_phone_number,
    p_patient_age,
    p_patient_gender,
    'normal',
    'waiting',
    '[Online Self-Booked Token]',
    0
  )
  returning * into v_ticket;

  return pg_catalog.jsonb_build_object(
    'mode', 'free',
    'free_reason', v_free_reason,
    'ticket', pg_catalog.to_jsonb(v_ticket)
  );
end;
$$;

revoke all on function public.book_patient_token_or_quote_fee(
  uuid, text, uuid, uuid, text, text, integer, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.book_patient_token_or_quote_fee(
  uuid, text, uuid, uuid, text, text, integer, text, timestamptz, timestamptz
) to service_role;

create or replace function public.enforce_online_booking_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id text;
  v_doctor_clinic_id text;
  v_doctor_department_id uuid;
  v_payment public.clinic_booking_payments%rowtype;
  v_role text;
  v_user_id uuid;
begin
  v_role := auth.role();
  v_user_id := auth.uid();

  if v_role is distinct from 'service_role' and v_user_id is null then
    raise exception 'Sign in is required to create a token';
  end if;

  if v_role is distinct from 'service_role'
    and new.patient_user_id is not null
    and new.patient_user_id is distinct from v_user_id then
    raise exception 'A patient can only create a token for their own account';
  end if;

  v_clinic_id := nullif(pg_catalog.to_jsonb(new)->>'clinic_id', '');
  if new.doctor_id is not null then
    select doctor.clinic_id::text, doctor.department_id
      into v_doctor_clinic_id, v_doctor_department_id
      from public.doctors as doctor
      where doctor.id = new.doctor_id;
  end if;
  if v_clinic_id is null then
    v_clinic_id := v_doctor_clinic_id;
  end if;

  if (new.patient_user_id is not null or new.booking_payment_id is not null)
    and (
      v_doctor_clinic_id is null
      or v_doctor_clinic_id is distinct from v_clinic_id
      or v_doctor_department_id is distinct from new.department_id
    ) then
    raise exception 'The doctor and clinic do not match';
  end if;

  if new.booking_payment_id is not null then
    select payment.*
      into v_payment
      from public.clinic_booking_payments as payment
      where payment.id = new.booking_payment_id
        and payment.status = 'paid';

    if not found
      or v_payment.patient_user_id is distinct from new.patient_user_id
      or v_payment.clinic_id is distinct from v_clinic_id
      or v_payment.doctor_id is distinct from new.doctor_id
      or v_payment.department_id is distinct from new.department_id
      or v_payment.booking_fee is distinct from new.booking_fee_paid then
      raise exception 'A verified booking payment is required';
    end if;

    return new;
  end if;

  if new.patient_user_id is not null
    and v_role = 'service_role'
    and new.booking_fee_paid = 0 then
    return new;
  end if;

  if new.patient_user_id is not null then
    raise exception 'Online patient bookings must use the platform booking API';
  end if;

  if v_role is distinct from 'service_role' and not exists (
    select 1
    from public.clinics as clinic
    where clinic.id::text = v_clinic_id
      and clinic.owner_id = v_user_id
  ) then
    raise exception 'Only clinic staff can create walk-in tokens';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_online_booking_payment()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

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
  v_is_clinic_staff_update boolean := false;
begin
  v_role := auth.role();
  v_user_id := auth.uid();

  if v_role is distinct from 'service_role' and v_user_id is null then
    raise exception 'Sign in is required to create a token';
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

  if v_role is distinct from 'service_role'
    and new.patient_user_id is not null
    and new.patient_user_id is distinct from v_user_id then
    if tg_op <> 'UPDATE' or new.patient_user_id is distinct from old.patient_user_id then
      raise exception 'A patient can only create a token for their own account';
    end if;

    if not exists (
      select 1
      from public.clinics as clinic
      where clinic.id::text = v_clinic_id
        and clinic.owner_id = v_user_id
    ) then
      raise exception 'A patient can only create a token for their own account';
    end if;

    v_is_clinic_staff_update := true;
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

  if v_is_clinic_staff_update then
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

create table if not exists public.clinic_booking_payments (
  id uuid primary key default gen_random_uuid(),
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  patient_user_id uuid not null references auth.users(id) on delete restrict,
  clinic_id text not null,
  doctor_id uuid not null,
  department_id uuid not null,
  patient_name text not null,
  phone_number text not null,
  patient_age integer not null check (patient_age between 0 and 120),
  patient_gender text not null,
  booking_fee numeric(10, 2) not null check (booking_fee > 0),
  currency text not null check (currency = 'INR'),
  status text not null default 'created' check (status in ('created', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_booking_payments enable row level security;
revoke all on table public.clinic_booking_payments from public, anon, authenticated;
grant all on table public.clinic_booking_payments to service_role;

alter table public.tickets
  add column if not exists booking_fee_paid numeric(10, 2)
  check (booking_fee_paid is null or booking_fee_paid >= 0);

alter table public.tickets
  add column if not exists booking_payment_id uuid
  references public.clinic_booking_payments(id) on delete restrict;

create unique index if not exists tickets_booking_payment_id_key
  on public.tickets (booking_payment_id);

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
  v_is_free boolean;
  v_has_fee_setting boolean;
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

  if new.patient_user_id is not null then
    select settings.is_free
      into v_is_free
      from public.clinic_fee_settings as settings
      where settings.clinic_id = v_clinic_id;
    v_has_fee_setting := found;

    if not v_has_fee_setting or not v_is_free then
      raise exception 'Online booking requires a verified payment';
    end if;

    new.booking_fee_paid := 0;
    return new;
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

revoke all on function public.enforce_online_booking_payment() from public, anon, authenticated;

drop trigger if exists enforce_online_booking_payment_insert on public.tickets;
create trigger enforce_online_booking_payment_insert
before insert on public.tickets
for each row execute function public.enforce_online_booking_payment();

drop trigger if exists enforce_online_booking_payment_update on public.tickets;
create trigger enforce_online_booking_payment_update
before update of clinic_id, doctor_id, department_id, patient_user_id, booking_fee_paid, booking_payment_id
on public.tickets
for each row execute function public.enforce_online_booking_payment();

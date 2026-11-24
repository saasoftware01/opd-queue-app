alter table public.whatsapp_login_otps
  add column if not exists purpose text not null default 'login';

delete from public.whatsapp_login_otps
where purpose = 'login';

alter table public.whatsapp_login_otps
  alter column purpose drop default;

alter table public.whatsapp_login_otps
  drop constraint if exists whatsapp_login_otps_pkey;

alter table public.whatsapp_login_otps
  add constraint whatsapp_login_otps_pkey primary key (phone_hash, purpose);

alter table public.whatsapp_login_otps
  drop constraint if exists whatsapp_login_otps_purpose_check;

alter table public.whatsapp_login_otps
  add constraint whatsapp_login_otps_purpose_check
  check (purpose in ('registration', 'password_reset'));

drop function if exists public.store_whatsapp_login_otp(text, text);
drop function if exists public.consume_whatsapp_login_otp(text, text);

create or replace function public.store_whatsapp_login_otp(
  p_phone_hash text,
  p_otp_hash text,
  p_purpose text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored boolean;
begin
  if p_phone_hash is null
    or p_otp_hash is null
    or p_purpose is null
    or p_phone_hash !~ '^[0-9a-f]{64}$'
    or p_otp_hash !~ '^[0-9a-f]{64}$'
    or p_purpose not in ('registration', 'password_reset') then
    raise exception 'Invalid OTP record.';
  end if;

  delete from public.whatsapp_login_otps
  where expires_at <= now();

  insert into public.whatsapp_login_otps (phone_hash, otp_hash, purpose, expires_at)
  values (p_phone_hash, p_otp_hash, p_purpose, now() + interval '3 minutes')
  on conflict (phone_hash, purpose) do update
  set otp_hash = excluded.otp_hash,
      created_at = now(),
      expires_at = excluded.expires_at,
      attempt_count = 0
  where public.whatsapp_login_otps.created_at <= now() - interval '1 minute'
  returning true into v_stored;

  return coalesce(v_stored, false);
end;
$$;

create or replace function public.consume_whatsapp_login_otp(
  p_phone_hash text,
  p_otp_hash text,
  p_purpose text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otp_hash text;
  v_attempt_count integer;
begin
  if p_phone_hash is null
    or p_otp_hash is null
    or p_purpose is null
    or p_phone_hash !~ '^[0-9a-f]{64}$'
    or p_otp_hash !~ '^[0-9a-f]{64}$'
    or p_purpose not in ('registration', 'password_reset') then
    return false;
  end if;

  select otp_hash, attempt_count
  into v_otp_hash, v_attempt_count
  from public.whatsapp_login_otps
  where phone_hash = p_phone_hash
    and purpose = p_purpose
    and expires_at > now()
  for update;

  if not found or v_attempt_count >= 5 then
    return false;
  end if;

  if v_otp_hash = p_otp_hash then
    delete from public.whatsapp_login_otps
    where phone_hash = p_phone_hash
      and purpose = p_purpose;
    return true;
  end if;

  update public.whatsapp_login_otps
  set attempt_count = attempt_count + 1
  where phone_hash = p_phone_hash
    and purpose = p_purpose;

  return false;
end;
$$;

revoke all on function public.store_whatsapp_login_otp(text, text, text)
  from public, anon, authenticated;
grant execute on function public.store_whatsapp_login_otp(text, text, text)
  to service_role;

revoke all on function public.consume_whatsapp_login_otp(text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_whatsapp_login_otp(text, text, text)
  to service_role;

create or replace function public.find_whatsapp_auth_user_by_phone(
  p_phone_digits text
)
returns table (
  user_id uuid,
  user_email text,
  auth_phone text,
  user_metadata jsonb,
  app_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone_digits !~ '^[6-9][0-9]{9}$' then
    return;
  end if;

  return query
  select
    users.id,
    users.email::text,
    users.phone::text,
    users.raw_user_meta_data,
    users.raw_app_meta_data
  from auth.users as users
  where exists (
    select 1
    from public.patients as patient
    where patient.id = users.id
  )
    and (
      regexp_replace(coalesce(users.phone, ''), '[^0-9]', '', 'g')
        in (p_phone_digits, '91' || p_phone_digits)
      or regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g')
        in (p_phone_digits, '91' || p_phone_digits)
    )
  order by case
    when regexp_replace(coalesce(users.phone, ''), '[^0-9]', '', 'g')
      in (p_phone_digits, '91' || p_phone_digits) then 0
    else 1
  end, users.created_at;
end;
$$;

revoke all on function public.find_whatsapp_auth_user_by_phone(text)
  from public, anon, authenticated;
grant execute on function public.find_whatsapp_auth_user_by_phone(text)
  to service_role;

notify pgrst, 'reload schema';

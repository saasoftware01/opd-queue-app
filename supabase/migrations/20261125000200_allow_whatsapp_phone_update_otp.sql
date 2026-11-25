alter table public.whatsapp_login_otps
  drop constraint if exists whatsapp_login_otps_purpose_check;

alter table public.whatsapp_login_otps
  add constraint whatsapp_login_otps_purpose_check
  check (purpose in ('registration', 'password_reset', 'phone_update'));

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
  v_cooldown_reserved boolean;
  v_stored boolean;
begin
  if p_phone_hash is null
    or p_otp_hash is null
    or p_purpose is null
    or p_phone_hash !~ '^[0-9a-f]{64}$'
    or p_otp_hash !~ '^[0-9a-f]{64}$'
    or p_purpose not in ('registration', 'password_reset', 'phone_update') then
    raise exception 'Invalid OTP record.';
  end if;

  delete from public.whatsapp_login_otps
  where expires_at <= now();

  delete from public.whatsapp_login_otp_cooldowns
  where last_requested_at <= now() - interval '1 day';

  insert into public.whatsapp_login_otp_cooldowns (phone_hash, last_requested_at)
  values (p_phone_hash, now())
  on conflict (phone_hash) do update
  set last_requested_at = excluded.last_requested_at
  where public.whatsapp_login_otp_cooldowns.last_requested_at <= now() - interval '1 minute'
  returning true into v_cooldown_reserved;

  if not coalesce(v_cooldown_reserved, false) then
    return false;
  end if;

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
    or p_purpose not in ('registration', 'password_reset', 'phone_update') then
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

notify pgrst, 'reload schema';

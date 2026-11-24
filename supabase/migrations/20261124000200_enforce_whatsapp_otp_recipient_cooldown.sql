create table if not exists public.whatsapp_login_otp_cooldowns (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  last_requested_at timestamptz not null
);

create index if not exists whatsapp_login_otp_cooldowns_requested_at_idx
  on public.whatsapp_login_otp_cooldowns (last_requested_at);

alter table public.whatsapp_login_otp_cooldowns enable row level security;
revoke all on table public.whatsapp_login_otp_cooldowns from public, anon, authenticated;
grant all on table public.whatsapp_login_otp_cooldowns to service_role;

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
    or p_purpose not in ('registration', 'password_reset') then
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

revoke all on function public.store_whatsapp_login_otp(text, text, text)
  from public, anon, authenticated;
grant execute on function public.store_whatsapp_login_otp(text, text, text)
  to service_role;

notify pgrst, 'reload schema';

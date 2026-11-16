create table if not exists public.whatsapp_login_otps (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  otp_hash text not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists whatsapp_login_otps_expires_at_idx
  on public.whatsapp_login_otps (expires_at);

alter table public.whatsapp_login_otps enable row level security;

create or replace function public.store_whatsapp_login_otp(
  p_phone_hash text,
  p_otp_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored boolean;
begin
  if p_phone_hash !~ '^[0-9a-f]{64}$' or p_otp_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid OTP record.';
  end if;

  delete from public.whatsapp_login_otps
  where expires_at <= now();

  insert into public.whatsapp_login_otps (phone_hash, otp_hash, expires_at)
  values (p_phone_hash, p_otp_hash, now() + interval '3 minutes')
  on conflict (phone_hash) do update
  set otp_hash = excluded.otp_hash,
      created_at = now(),
      expires_at = excluded.expires_at
  where public.whatsapp_login_otps.created_at <= now() - interval '1 minute'
  returning true into v_stored;

  return coalesce(v_stored, false);
end;
$$;

revoke all on function public.store_whatsapp_login_otp(text, text)
  from public, anon, authenticated;
grant execute on function public.store_whatsapp_login_otp(text, text)
  to service_role;

create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  is_globally_free boolean not null default true,
  platform_fee numeric(10, 2) not null default 5.00,
  enforce_referral_system boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id)
select gen_random_uuid()
where not exists (select 1 from public.platform_settings);

create table if not exists public.patients (
  id uuid primary key references auth.users(id) on delete cascade,
  referral_code text unique,
  referred_by text,
  free_tokens_balance integer not null default 2
);

create table if not exists public.clinic_fee_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null unique,
  clinic_name text not null,
  is_free boolean not null default true,
  booking_fee numeric(10, 2) not null default 0.00,
  currency text not null default 'INR',
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint clinic_fee_settings_amount_check
    check (
      (is_free and booking_fee = 0)
      or (not is_free and booking_fee > 0)
    ),
  constraint clinic_fee_settings_currency_check
    check (currency ~ '^[A-Z]{3}$')
);

update public.clinic_fee_settings
set is_free = coalesce(is_free, true),
    booking_fee = coalesce(booking_fee, 0),
    currency = upper(coalesce(nullif(currency, ''), 'INR')),
    updated_at = coalesce(updated_at, timezone('utc'::text, now()));

update public.clinic_fee_settings
set booking_fee = 0
where is_free;

update public.clinic_fee_settings
set is_free = true
where booking_fee = 0;

alter table public.clinic_fee_settings
  alter column is_free set not null,
  alter column booking_fee set not null,
  alter column currency set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_fee_settings_amount_check'
      and conrelid = 'public.clinic_fee_settings'::regclass
  ) then
    alter table public.clinic_fee_settings
      add constraint clinic_fee_settings_amount_check
      check (
        (is_free and booking_fee = 0)
        or (not is_free and booking_fee > 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_fee_settings_currency_check'
      and conrelid = 'public.clinic_fee_settings'::regclass
  ) then
    alter table public.clinic_fee_settings
      add constraint clinic_fee_settings_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end
$$;

alter table public.clinic_fee_settings enable row level security;

drop policy if exists "Allow public read access on clinic fee settings"
  on public.clinic_fee_settings;
create policy "Allow public read access on clinic fee settings"
  on public.clinic_fee_settings for select using (true);

grant select on public.clinic_fee_settings to anon, authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinics'
      and column_name = 'booking_fee'
  ) then
    execute $query$
      insert into public.clinic_fee_settings (clinic_id, clinic_name, is_free, booking_fee)
      select
        clinic.id::text,
        clinic.name,
        coalesce(clinic.booking_fee, 0) = 0,
        coalesce(clinic.booking_fee, 0)
      from public.clinics as clinic
      on conflict (clinic_id) do nothing
    $query$;
  else
    insert into public.clinic_fee_settings (clinic_id, clinic_name)
    select clinic.id::text, clinic.name
    from public.clinics as clinic
    on conflict (clinic_id) do nothing;
  end if;
end
$$;

create or replace function public.set_clinic_fee_settings_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

revoke all on function public.set_clinic_fee_settings_updated_at() from public, anon, authenticated;

drop trigger if exists set_clinic_fee_settings_updated_at_trigger on public.clinic_fee_settings;
create trigger set_clinic_fee_settings_updated_at_trigger
before update on public.clinic_fee_settings
for each row execute function public.set_clinic_fee_settings_updated_at();

create or replace function public.sync_clinic_fee_setting_to_clinic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinics'
      and column_name = 'booking_fee'
  ) then
    execute
      'update public.clinics set booking_fee = $1 where id::text = $2'
      using case when new.is_free then 0 else new.booking_fee end, new.clinic_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_clinic_fee_setting_to_clinic() from public, anon, authenticated;

drop trigger if exists sync_clinic_fee_setting_to_clinic_trigger on public.clinic_fee_settings;
create trigger sync_clinic_fee_setting_to_clinic_trigger
after insert or update of is_free, booking_fee on public.clinic_fee_settings
for each row execute function public.sync_clinic_fee_setting_to_clinic();

create or replace function public.ensure_clinic_fee_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clinic_fee numeric(10, 2);
begin
  clinic_fee := coalesce(nullif(to_jsonb(new)->>'booking_fee', '')::numeric, 0);

  insert into public.clinic_fee_settings (clinic_id, clinic_name, is_free, booking_fee)
  values (new.id::text, new.name, clinic_fee = 0, clinic_fee)
  on conflict (clinic_id) do update
    set clinic_name = excluded.clinic_name;

  return new;
end;
$$;

revoke all on function public.ensure_clinic_fee_setting() from public, anon, authenticated;

drop trigger if exists ensure_clinic_fee_setting_trigger on public.clinics;
create trigger ensure_clinic_fee_setting_trigger
after insert or update of name on public.clinics
for each row execute function public.ensure_clinic_fee_setting();

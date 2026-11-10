alter table public.clinics
  add column if not exists city text,
  add column if not exists address text;

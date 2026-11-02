alter table public.doctors
  add column if not exists opd_sessions jsonb not null default '[]'::jsonb;

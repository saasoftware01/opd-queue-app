alter table public.tickets
  add column if not exists patient_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.patient_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (ticket_id, endpoint)
);

alter table public.patient_push_subscriptions enable row level security;

create table if not exists public.patient_push_dispatches (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  called_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (ticket_id, called_at)
);

alter table public.patient_push_dispatches enable row level security;

-- ==========================================
-- OPD QUEUE MANAGEMENT SYSTEM - DATABASE SCHEMA
-- ==========================================

-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Departments table
create table if not exists public.departments (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  code text not null unique, -- e.g., 'GEN', 'CARD', 'PEDS'
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Doctors table
create table if not exists public.doctors (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  department_id uuid references public.departments(id) on delete cascade not null,
  room_number text not null, -- e.g., 'Room 101'
  is_available boolean default true not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Ticket Status enum & Tickets / Queue table
create type public.ticket_status as enum ('waiting', 'in-consultation', 'completed', 'skipped', 'cancelled');
create type public.priority_type as enum ('normal', 'emergency', 'senior');

create table if not exists public.tickets (
  id uuid default uuid_generate_v4() primary key,
  token_number text not null, -- e.g., 'GEN-001'
  patient_name text not null,
  phone_number text,
  department_id uuid references public.departments(id) on delete cascade not null,
  doctor_id uuid references public.doctors(id) on delete set null,
  status ticket_status default 'waiting' not null,
  priority priority_type default 'normal' not null,
  notes text,
  called_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Enable Row Level Security (RLS)
alter table public.departments enable row level security;
alter table public.doctors enable row level security;
alter table public.tickets enable row level security;

-- 6. Create policies for public access (or authenticated staff)
-- For easy setup and demo, we allow public read/write access. You can tighten this with Supabase Auth later.
create policy "Allow public read access on departments" on public.departments for select using (true);
create policy "Allow public insert/update on departments" on public.departments for all using (true);

create policy "Allow public read access on doctors" on public.doctors for select using (true);
create policy "Allow public insert/update on doctors" on public.doctors for all using (true);

create policy "Allow public read access on tickets" on public.tickets for select using (true);
create policy "Allow public insert/update on tickets" on public.tickets for all using (true);

-- 7. Enable Supabase Realtime for live updates on queue screens
alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.doctors;

-- 8. Seed Sample Data (Departments & Doctors)
insert into public.departments (name, code, description) values
  ('General Medicine', 'GEN', 'Primary care and general consultations'),
  ('Cardiology', 'CARD', 'Heart and cardiovascular care'),
  ('Pediatrics', 'PEDS', 'Child healthcare and immunizations'),
  ('Orthopedics', 'ORTH', 'Bone, joint, and muscle care')
on conflict (code) do nothing;

-- Seed Sample Doctors (Linking to departments)
do $$
declare
  gen_id uuid;
  card_id uuid;
  peds_id uuid;
  orth_id uuid;
begin
  select id into gen_id from public.departments where code = 'GEN';
  select id into card_id from public.departments where code = 'CARD';
  select id into peds_id from public.departments where code = 'PEDS';
  select id into orth_id from public.departments where code = 'ORTH';

  insert into public.doctors (name, department_id, room_number, is_available) values
    ('Dr. Robert Chen', gen_id, 'Room 101', true),
    ('Dr. Sarah Jenkins', gen_id, 'Room 102', true),
    ('Dr. Michael Patel', card_id, 'Room 201', true),
    ('Dr. Emily Watson', peds_id, 'Room 301', true),
    ('Dr. James Wilson', orth_id, 'Room 401', true)
  on conflict do nothing;
end $$;

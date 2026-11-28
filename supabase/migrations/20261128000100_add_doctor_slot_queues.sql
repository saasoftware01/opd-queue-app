create table if not exists public.doctor_slots (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  slot_name text not null,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint doctor_slots_doctor_name_key unique (doctor_id, slot_name),
  constraint doctor_slots_distinct_times_check check (start_time <> end_time)
);

alter table public.doctor_slots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'doctor_slots'
      and policyname = 'Allow public read access on doctor slots'
  ) then
    create policy "Allow public read access on doctor slots"
      on public.doctor_slots for select using (true);
  end if;
end;
$$;

grant select on public.doctor_slots to anon, authenticated;

create or replace function public.sync_doctor_slots_from_opd_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session jsonb;
  v_slot_name text;
  v_start_time time;
  v_end_time time;
  v_slot_names text[] := array[]::text[];
begin
  for v_session in
    select value
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(new.opd_sessions) = 'array' then new.opd_sessions
        else '[]'::jsonb
      end
    )
  loop
    v_slot_name := nullif(pg_catalog.btrim(v_session ->> 'shift'), '');
    if v_slot_name is null then
      raise exception 'Each OPD session must have a shift name';
    end if;

    begin
      v_start_time := (v_session ->> 'start_time')::time;
      v_end_time := (v_session ->> 'end_time')::time;
    exception
      when invalid_text_representation or null_value_not_allowed then
        raise exception 'OPD session % must have valid start and end times', v_slot_name;
    end;

    if v_start_time = v_end_time then
      raise exception 'OPD session % must have different start and end times', v_slot_name;
    end if;

    insert into public.doctor_slots (
      doctor_id,
      slot_name,
      start_time,
      end_time,
      is_active
    )
    values (
      new.id,
      v_slot_name,
      v_start_time,
      v_end_time,
      true
    )
    on conflict (doctor_id, slot_name)
    do update set
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      is_active = true;

    v_slot_names := pg_catalog.array_append(v_slot_names, v_slot_name);
  end loop;

  update public.doctor_slots
  set is_active = false
  where doctor_id = new.id
    and is_active
    and not (slot_name = any(v_slot_names));

  return new;
end;
$$;

revoke all on function public.sync_doctor_slots_from_opd_sessions()
  from public, anon, authenticated;

drop trigger if exists sync_doctor_slots_from_opd_sessions_trigger on public.doctors;
create trigger sync_doctor_slots_from_opd_sessions_trigger
after insert or update of opd_sessions on public.doctors
for each row execute function public.sync_doctor_slots_from_opd_sessions();

update public.doctors
set opd_sessions = opd_sessions;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tickets'
      and column_name = 'token_number'
      and data_type = 'text'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tickets'
      and column_name = 'token_code'
  ) then
    alter table public.tickets rename column token_number to token_code;
  end if;
end;
$$;

alter table public.tickets
  add column if not exists token_number integer;

alter table public.tickets
  add column if not exists token_code text;

alter table public.tickets
  add column if not exists booking_date date;

alter table public.tickets
  add column if not exists slot_id uuid references public.doctor_slots(id) on delete set null;

alter table public.tickets
  alter column token_number set default 0;

update public.tickets
set booking_date = (created_at at time zone 'Asia/Kolkata')::date
where booking_date is null;

alter table public.tickets
  alter column booking_date set default ((now() at time zone 'Asia/Kolkata')::date);

insert into public.doctor_slots (doctor_id, slot_name, start_time, end_time, is_active)
select doctor_id, 'Legacy', time '00:00', time '23:59', false
from (
  select ticket.doctor_id
  from public.tickets as ticket
  where ticket.doctor_id is not null
  union
  select payment.doctor_id
  from public.clinic_booking_payments as payment
  where payment.doctor_id is not null
) as doctors_with_tickets
where not exists (
    select 1
    from public.doctor_slots as slot
    where slot.doctor_id = doctors_with_tickets.doctor_id
  )
on conflict (doctor_id, slot_name) do nothing;

update public.tickets as ticket
set slot_id = coalesce(
  (
    select slot.id
    from public.doctor_slots as slot
    where slot.doctor_id = ticket.doctor_id
    order by
      case
        when slot.is_active
          and (
            (slot.start_time < slot.end_time
              and (ticket.created_at at time zone 'Asia/Kolkata')::time >= slot.start_time
              and (ticket.created_at at time zone 'Asia/Kolkata')::time < slot.end_time)
            or (slot.start_time > slot.end_time
              and ((ticket.created_at at time zone 'Asia/Kolkata')::time >= slot.start_time
                or (ticket.created_at at time zone 'Asia/Kolkata')::time < slot.end_time))
          )
          then 0
        when slot.is_active then 1
        else 2
      end,
      slot.start_time,
      slot.id
    limit 1
  ),
  ticket.slot_id
)
where ticket.doctor_id is not null
  and ticket.slot_id is null;

with numbered_tickets as (
  select
    ticket.id,
    row_number() over (
      partition by ticket.doctor_id, ticket.slot_id, ticket.booking_date
      order by ticket.created_at, ticket.id
    )::integer as slot_number
  from public.tickets as ticket
  where ticket.doctor_id is not null
    and ticket.slot_id is not null
)
update public.tickets as ticket
set token_number = numbered_tickets.slot_number
from numbered_tickets
where ticket.id = numbered_tickets.id;

update public.tickets
set token_number = coalesce(
  nullif(pg_catalog.substring(token_code, '([0-9]+)$'), '')::integer,
  1
)
where token_number is null;

update public.tickets
set token_code = coalesce(
  token_code,
  'T-' || pg_catalog.lpad(token_number::text, 3, '0')
)
where token_code is null;

alter table public.tickets
  alter column token_number set not null,
  alter column token_code set not null,
  alter column booking_date set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tickets_doctor_slot_booking_token_key'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_doctor_slot_booking_token_key
      unique (doctor_id, slot_id, booking_date, token_number);
  end if;
end;
$$;

create index if not exists tickets_slot_queue_lookup_idx
  on public.tickets (doctor_id, slot_id, booking_date, status, token_number);

alter table public.clinic_booking_payments
  add column if not exists slot_id uuid references public.doctor_slots(id) on delete restrict;

alter table public.clinic_booking_payments
  add column if not exists booking_date date;

update public.clinic_booking_payments as payment
set slot_id = (
  select doctor_slot.id
  from public.doctor_slots as doctor_slot
  where doctor_slot.doctor_id = payment.doctor_id
  order by doctor_slot.is_active desc, doctor_slot.start_time, doctor_slot.id
  limit 1
)
where payment.slot_id is null;

update public.clinic_booking_payments
set booking_date = (created_at at time zone 'Asia/Kolkata')::date
where booking_date is null;

alter table public.clinic_booking_payments
  alter column slot_id set not null,
  alter column booking_date set not null;

create table if not exists public.ticket_slot_token_counters (
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  slot_id uuid not null references public.doctor_slots(id) on delete cascade,
  booking_date date not null,
  last_value integer not null check (last_value >= 0),
  primary key (doctor_id, slot_id, booking_date)
);

alter table public.ticket_slot_token_counters enable row level security;
revoke all on table public.ticket_slot_token_counters from public, anon, authenticated;

create or replace function public.assign_ticket_token_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.doctor_slots%rowtype;
  v_prefix text;
  v_next_value integer;
  v_initial_value integer;
  v_clinic_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_clinic_time time := (now() at time zone 'Asia/Kolkata')::time;
begin
  if new.doctor_id is null or new.slot_id is null then
    raise exception 'A doctor and OPD slot are required to issue a token';
  end if;
  if new.booking_date is null then
    raise exception 'A booking date is required to issue a token';
  end if;
  if new.booking_date < v_clinic_date then
    raise exception 'Tokens cannot be booked for a past date';
  end if;

  select slot.*
  into v_slot
  from public.doctor_slots as slot
  where slot.id = new.slot_id
    and slot.doctor_id = new.doctor_id
    and slot.is_active;

  if not found then
    raise exception 'The selected OPD slot is not active for this doctor';
  end if;

  if new.booking_date = v_clinic_date
    and (
      (v_slot.start_time < v_slot.end_time and v_clinic_time >= v_slot.end_time)
      or (v_slot.start_time > v_slot.end_time
        and v_clinic_time >= v_slot.end_time
        and v_clinic_time < v_slot.start_time)
    ) then
    raise exception 'The selected OPD slot has already ended';
  end if;

  v_prefix := case pg_catalog.lower(v_slot.slot_name)
    when 'morning' then 'M'
    when 'evening' then 'E'
    else pg_catalog.left(
      pg_catalog.regexp_replace(pg_catalog.upper(v_slot.slot_name), '[^A-Z0-9]', '', 'g'),
      1
    )
  end;
  if v_prefix is null or v_prefix = '' then
    raise exception 'Unable to determine a token prefix for OPD slot %', v_slot.slot_name;
  end if;

  select coalesce(max(ticket.token_number), 0)
  into v_initial_value
  from public.tickets as ticket
  where ticket.doctor_id = new.doctor_id
    and ticket.slot_id = new.slot_id
    and ticket.booking_date = new.booking_date;

  insert into public.ticket_slot_token_counters as counters (
    doctor_id,
    slot_id,
    booking_date,
    last_value
  )
  values (
    new.doctor_id,
    new.slot_id,
    new.booking_date,
    v_initial_value + 1
  )
  on conflict (doctor_id, slot_id, booking_date)
  do update set last_value = greatest(counters.last_value, excluded.last_value - 1) + 1
  returning last_value into v_next_value;

  new.token_number := v_next_value;
  new.token_code := v_prefix || '-' || pg_catalog.lpad(v_next_value::text, 3, '0');
  return new;
end;
$$;

revoke all on function public.assign_ticket_token_number() from public, anon, authenticated;

drop trigger if exists assign_ticket_token_number_trigger on public.tickets;
create trigger assign_ticket_token_number_trigger
before insert on public.tickets
for each row execute function public.assign_ticket_token_number();

create or replace function public.prevent_duplicate_active_patient_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_token text;
begin
  if new.doctor_id is null
    or new.booking_date is null
    or new.status not in ('waiting', 'in-consultation')
    or (new.patient_user_id is null and new.phone_number is null) then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('waiting', 'in-consultation')
    and new.status in ('waiting', 'in-consultation')
    and new.doctor_id is not distinct from old.doctor_id
    and new.booking_date is not distinct from old.booking_date
    and new.patient_user_id is not distinct from old.patient_user_id
    and new.phone_number is not distinct from old.phone_number then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.doctor_id::text || ':' || new.booking_date::text, 0)
  );

  select ticket.token_code
  into v_existing_token
  from public.tickets as ticket
  where ticket.id is distinct from new.id
    and ticket.doctor_id = new.doctor_id
    and ticket.booking_date = new.booking_date
    and ticket.status in ('waiting', 'in-consultation')
    and (
      (
        new.patient_user_id is not null
        and ticket.patient_user_id = new.patient_user_id
      )
      or (
        new.phone_number is not null
        and ticket.phone_number is not null
        and pg_catalog.regexp_replace(ticket.phone_number, '[^0-9]', '', 'g')
          = pg_catalog.regexp_replace(new.phone_number, '[^0-9]', '', 'g')
      )
    )
    and (
      new.booking_payment_id is null
      or ticket.booking_payment_id is distinct from new.booking_payment_id
    )
  limit 1;

  if found then
    raise exception using
      errcode = '23505',
      message = 'An active token already exists for this patient and doctor today';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_duplicate_active_patient_booking()
  from public, anon, authenticated;

drop trigger if exists prevent_duplicate_active_patient_booking_trigger on public.tickets;
create trigger prevent_duplicate_active_patient_booking_trigger
before insert or update on public.tickets
for each row execute function public.prevent_duplicate_active_patient_booking();

drop function if exists public.book_patient_token_or_quote_fee(
  uuid, text, uuid, uuid, text, text, integer, text, timestamptz, timestamptz
);

create or replace function public.book_patient_token_or_quote_fee(
  p_patient_user_id uuid,
  p_clinic_id text,
  p_doctor_id uuid,
  p_department_id uuid,
  p_slot_id uuid,
  p_booking_date date,
  p_patient_name text,
  p_phone_number text,
  p_patient_age integer,
  p_patient_gender text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.platform_settings%rowtype;
  v_balance integer;
  v_phone_suffix text;
  v_referral_code text;
  v_existing_token text;
  v_free_reason text;
  v_ticket public.tickets%rowtype;
begin
  if not exists (
    select 1
    from public.doctor_slots as slot
    where slot.id = p_slot_id
      and slot.doctor_id = p_doctor_id
      and slot.is_active
  ) then
    raise exception 'The selected OPD slot is not active for this doctor';
  end if;

  select settings.*
  into v_settings
  from public.platform_settings as settings
  order by settings.id
  limit 1
  for share;

  if not found then
    raise exception 'Platform settings are not configured';
  end if;

  select patient.free_tokens_balance
  into v_balance
  from public.patients as patient
  where patient.id = p_patient_user_id
  for update;

  if not found then
    v_phone_suffix := pg_catalog.right(
      '0000' || pg_catalog.regexp_replace(p_phone_number, '[^0-9]', '', 'g'),
      4
    );

    loop
      v_referral_code := v_phone_suffix || pg_catalog.upper(
        pg_catalog.substr(
          pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
          1,
          6
        )
      );

      insert into public.patients (id, referral_code)
      values (p_patient_user_id, v_referral_code)
      on conflict do nothing;

      exit when found;

      select patient.free_tokens_balance
      into v_balance
      from public.patients as patient
      where patient.id = p_patient_user_id
      for update;

      exit when found;
    end loop;

    select patient.free_tokens_balance
    into v_balance
    from public.patients as patient
    where patient.id = p_patient_user_id
    for update;
  end if;

  select ticket.token_code
  into v_existing_token
  from public.tickets as ticket
  where ticket.doctor_id = p_doctor_id
    and ticket.booking_date = p_booking_date
    and ticket.status in ('waiting', 'in-consultation')
    and (
      ticket.patient_user_id = p_patient_user_id
      or ticket.phone_number = p_phone_number
    )
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'mode', 'duplicate',
      'token_code', v_existing_token
    );
  end if;

  if v_settings.is_globally_free then
    v_free_reason := 'global';
  elsif v_balance > 0 then
    update public.patients as patient
    set free_tokens_balance = patient.free_tokens_balance - 1
    where patient.id = p_patient_user_id
      and patient.free_tokens_balance > 0;
    v_free_reason := 'free_token';
  else
    return pg_catalog.jsonb_build_object(
      'mode', 'payment',
      'platform_fee', v_settings.platform_fee
    );
  end if;

  v_ticket := pg_catalog.jsonb_populate_record(
    null::public.tickets,
    pg_catalog.jsonb_build_object('clinic_id', p_clinic_id)
  );

  insert into public.tickets (
    clinic_id,
    doctor_id,
    department_id,
    slot_id,
    booking_date,
    patient_user_id,
    token_number,
    token_code,
    patient_name,
    phone_number,
    patient_age,
    patient_gender,
    priority,
    status,
    notes,
    booking_fee_paid
  )
  values (
    v_ticket.clinic_id,
    p_doctor_id,
    p_department_id,
    p_slot_id,
    p_booking_date,
    p_patient_user_id,
    0,
    '',
    p_patient_name,
    p_phone_number,
    p_patient_age,
    p_patient_gender,
    'normal',
    'waiting',
    '[Online Self-Booked Token]',
    0
  )
  returning * into v_ticket;

  return pg_catalog.jsonb_build_object(
    'mode', 'free',
    'free_reason', v_free_reason,
    'ticket', pg_catalog.to_jsonb(v_ticket)
  );
end;
$$;

revoke all on function public.book_patient_token_or_quote_fee(
  uuid, text, uuid, uuid, uuid, date, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.book_patient_token_or_quote_fee(
  uuid, text, uuid, uuid, uuid, date, text, text, integer, text
) to service_role;

create or replace function public.call_next_ticket(
  p_doctor_id uuid,
  p_slot_id uuid,
  p_booking_date date
)
returns setof public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
begin
  if auth.role() is distinct from 'service_role'
    and not exists (
      select 1
      from public.doctors as doctor
      join public.clinics as clinic
        on clinic.id::text = doctor.clinic_id::text
      where doctor.id = p_doctor_id
        and clinic.owner_id = auth.uid()
    ) then
    raise exception 'Only the clinic owner can call the next token';
  end if;

  if exists (
    select 1
    from public.tickets as active_ticket
    where active_ticket.doctor_id = p_doctor_id
      and active_ticket.slot_id = p_slot_id
      and active_ticket.booking_date = p_booking_date
      and active_ticket.status = 'in-consultation'
  ) then
    raise exception 'Complete or hold the current consultation before calling another token';
  end if;

  select ticket.id
  into v_ticket_id
  from public.tickets as ticket
  where ticket.doctor_id = p_doctor_id
    and ticket.slot_id = p_slot_id
    and ticket.booking_date = p_booking_date
    and ticket.status = 'waiting'
  order by
    (ticket.priority = 'emergency') desc,
    ticket.token_number asc,
    ticket.created_at asc
  for update skip locked
  limit 1;

  if v_ticket_id is null then
    return;
  end if;

  return query
  update public.tickets as ticket
  set status = 'in-consultation',
      doctor_id = p_doctor_id,
      called_at = now()
  where ticket.id = v_ticket_id
    and ticket.status = 'waiting'
  returning ticket.*;
end;
$$;

revoke all on function public.call_next_ticket(uuid, uuid, date) from public, anon;
grant execute on function public.call_next_ticket(uuid, uuid, date) to authenticated, service_role;

notify pgrst, 'reload schema';

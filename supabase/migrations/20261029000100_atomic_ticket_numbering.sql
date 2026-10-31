create table if not exists public.ticket_token_counters (
  department_id uuid not null,
  token_prefix text not null,
  token_date date not null,
  last_value bigint not null check (last_value >= 0),
  primary key (department_id, token_prefix, token_date)
);

alter table public.ticket_token_counters enable row level security;
revoke all on table public.ticket_token_counters from public, anon, authenticated;

create or replace function public.assign_ticket_token_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_token_date date;
  v_next_value bigint;
  v_initial_value bigint;
begin
  v_prefix := nullif(pg_catalog.split_part(coalesce(new.token_number, ''), '-', 1), '');

  if v_prefix is null then
    select department.code
      into v_prefix
      from public.departments as department
      where department.id = new.department_id;
  end if;

  if v_prefix is null then
    raise exception 'Unable to determine token prefix for department %', new.department_id;
  end if;

  v_token_date := (new.created_at at time zone 'UTC')::date;

  select coalesce(
    max(
      case
        when pg_catalog.split_part(ticket.token_number, '-', 2) ~ '^[0-9]+$'
          then pg_catalog.split_part(ticket.token_number, '-', 2)::bigint
        else 0
      end
    ),
    0
  ) + 1
    into v_initial_value
    from public.tickets as ticket
    where ticket.department_id = new.department_id
      and (ticket.created_at at time zone 'UTC')::date = v_token_date
      and pg_catalog.split_part(ticket.token_number, '-', 1) = v_prefix;

  insert into public.ticket_token_counters as counters (
    department_id,
    token_prefix,
    token_date,
    last_value
  ) values (
    new.department_id,
    v_prefix,
    v_token_date,
    v_initial_value
  )
  on conflict (department_id, token_prefix, token_date)
  do update set last_value = case
    when counters.last_value > excluded.last_value then counters.last_value
    else excluded.last_value
  end + 1
  returning last_value into v_next_value;

  new.token_number := v_prefix || '-' || pg_catalog.lpad(v_next_value::text, 3, '0');
  return new;
end;
$$;

revoke all on function public.assign_ticket_token_number() from public, anon, authenticated;

drop trigger if exists assign_ticket_token_number_trigger on public.tickets;
create trigger assign_ticket_token_number_trigger
before insert on public.tickets
for each row execute function public.assign_ticket_token_number();
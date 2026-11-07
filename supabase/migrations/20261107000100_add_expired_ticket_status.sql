alter type public.ticket_status
  add value if not exists 'expired';

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

  v_token_date := (new.created_at at time zone 'Asia/Kolkata')::date;

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
      and (ticket.created_at at time zone 'Asia/Kolkata')::date = v_token_date
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
    when counters.last_value >= excluded.last_value - 1 then counters.last_value + 1
    else excluded.last_value
  end
  returning last_value into v_next_value;

  new.token_number := v_prefix || '-' || pg_catalog.lpad(v_next_value::text, 3, '0');
  return new;
end;
$$;

revoke all on function public.assign_ticket_token_number() from public, anon, authenticated;

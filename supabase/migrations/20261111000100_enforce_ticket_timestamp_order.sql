update public.tickets
set completed_at = created_at + interval '1 second'
where completed_at is not null
  and completed_at <= created_at;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_completion_after_booking_check'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_completion_after_booking_check
      check (completed_at is null or completed_at > created_at);
  end if;
end $$;

create or replace function public.ensure_ticket_completion_after_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.completed_at is not null and new.completed_at <= new.created_at then
    new.completed_at := new.created_at + interval '1 second';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_ticket_completion_after_booking() from public, anon, authenticated;

drop trigger if exists ensure_ticket_completion_after_booking_trigger on public.tickets;
create trigger ensure_ticket_completion_after_booking_trigger
before insert or update on public.tickets
for each row execute function public.ensure_ticket_completion_after_booking();

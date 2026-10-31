create table if not exists public.ticket_assignment_audit (
  id bigint generated always as identity primary key,
  ticket_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  previous_doctor_id uuid,
  new_doctor_id uuid,
  previous_status public.ticket_status,
  new_status public.ticket_status,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  request_role text
);

create index if not exists ticket_assignment_audit_ticket_changed_idx
  on public.ticket_assignment_audit (ticket_id, changed_at desc);

alter table public.ticket_assignment_audit enable row level security;
revoke all on table public.ticket_assignment_audit from public, anon, authenticated;

create or replace function public.audit_ticket_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_assignment_audit (
      ticket_id,
      operation,
      new_doctor_id,
      new_status,
      changed_by,
      request_role
    ) values (
      new.id,
      tg_op,
      new.doctor_id,
      new.status,
      auth.uid(),
      auth.role()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.doctor_id is not distinct from new.doctor_id
      and old.status is not distinct from new.status then
      return new;
    end if;

    insert into public.ticket_assignment_audit (
      ticket_id,
      operation,
      previous_doctor_id,
      new_doctor_id,
      previous_status,
      new_status,
      changed_by,
      request_role
    ) values (
      new.id,
      tg_op,
      old.doctor_id,
      new.doctor_id,
      old.status,
      new.status,
      auth.uid(),
      auth.role()
    );
    return new;
  end if;

  insert into public.ticket_assignment_audit (
    ticket_id,
    operation,
    previous_doctor_id,
    previous_status,
    changed_by,
    request_role
  ) values (
    old.id,
    tg_op,
    old.doctor_id,
    old.status,
    auth.uid(),
    auth.role()
  );
  return old;
end;
$$;

revoke all on function public.audit_ticket_assignment() from public, anon, authenticated;

drop trigger if exists ticket_assignment_audit_trigger on public.tickets;
create trigger ticket_assignment_audit_trigger
after insert or update or delete on public.tickets
for each row execute function public.audit_ticket_assignment();
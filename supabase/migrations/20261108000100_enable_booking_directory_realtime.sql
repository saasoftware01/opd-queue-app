do $$
declare
  table_name text;
begin
  if not exists (
    select 1
      from pg_publication
      where pubname = 'supabase_realtime'
  ) then
    raise exception 'Supabase Realtime publication does not exist';
  end if;

  foreach table_name in array array['doctors', 'tickets', 'departments', 'clinics']
  loop
    if to_regclass(format('public.%I', table_name)) is not null
      and not exists (
        select 1
          from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = table_name
      ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

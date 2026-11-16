do $$
declare
  v_user record;
  v_phone_suffix text;
  v_referral_code text;
begin
  for v_user in
    select auth_user.id,
           coalesce(auth_user.phone, auth_user.raw_user_meta_data ->> 'phone', '') as phone
      from auth.users as auth_user
      where auth_user.raw_user_meta_data ->> 'account_type' = 'patient'
        and not exists (
          select 1
            from public.patients as patient
            where patient.id = auth_user.id
        )
  loop
    v_phone_suffix := pg_catalog.right(
      '0000' || pg_catalog.regexp_replace(v_user.phone, '[^0-9]', '', 'g'),
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
      values (v_user.id, v_referral_code)
      on conflict do nothing;

      exit when found;

      if exists (
        select 1
          from public.patients as patient
          where patient.id = v_user.id
      ) then
        exit;
      end if;
    end loop;
  end loop;
end;
$$;

alter table public.patients enable row level security;

revoke all on table public.patients from public, anon, authenticated;
grant select on table public.patients to authenticated;
grant all on table public.patients to service_role;

drop policy if exists "Patients can read their own profile" on public.patients;
create policy "Patients can read their own profile"
  on public.patients
  for select
  to authenticated
  using ((select auth.uid()) = id);

notify pgrst, 'reload schema';

create or replace function public.find_whatsapp_auth_user_by_phone(
  p_phone_digits text
)
returns table (
  user_id uuid,
  user_email text,
  auth_phone text,
  user_metadata jsonb,
  app_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone_digits !~ '^[6-9][0-9]{9}$' then
    return;
  end if;

  return query
  select
    users.id,
    users.email::text,
    users.phone::text,
    users.raw_user_meta_data,
    users.raw_app_meta_data
  from auth.users as users
  where exists (
    select 1
    from public.patients as patient
    where patient.id = users.id
  )
    and (
      regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g')
        in (p_phone_digits, '91' || p_phone_digits)
      or (
        nullif(
          regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'),
          ''
        ) is null
        and regexp_replace(coalesce(users.phone, ''), '[^0-9]', '', 'g')
          in (p_phone_digits, '91' || p_phone_digits)
      )
    )
  order by case
    when regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g')
      in (p_phone_digits, '91' || p_phone_digits) then 0
    else 1
  end, users.created_at;
end;
$$;

revoke all on function public.find_whatsapp_auth_user_by_phone(text)
  from public, anon, authenticated;
grant execute on function public.find_whatsapp_auth_user_by_phone(text)
  to service_role;

create or replace function public.find_whatsapp_clinic_auth_user_by_phone(
  p_phone_digits text
)
returns table (
  user_id uuid,
  user_email text,
  auth_phone text,
  user_metadata jsonb,
  app_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone_digits !~ '^[6-9][0-9]{9}$' then
    return;
  end if;

  return query
  select
    users.id,
    users.email::text,
    users.phone::text,
    users.raw_user_meta_data,
    users.raw_app_meta_data
  from auth.users as users
  where exists (
    select 1
    from public.clinics as clinic
    where clinic.owner_id = users.id
  )
    and (
      regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g')
        in (p_phone_digits, '91' || p_phone_digits)
      or (
        nullif(
          regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'),
          ''
        ) is null
        and regexp_replace(coalesce(users.phone, ''), '[^0-9]', '', 'g')
          in (p_phone_digits, '91' || p_phone_digits)
      )
    )
  order by case
    when regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g')
      in (p_phone_digits, '91' || p_phone_digits) then 0
    else 1
  end, users.created_at;
end;
$$;

revoke all on function public.find_whatsapp_clinic_auth_user_by_phone(text)
  from public, anon, authenticated;
grant execute on function public.find_whatsapp_clinic_auth_user_by_phone(text)
  to service_role;

notify pgrst, 'reload schema';

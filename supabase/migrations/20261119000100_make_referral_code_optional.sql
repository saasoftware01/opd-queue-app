create or replace function public.create_patient_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone_digits text;
  v_phone_suffix text;
  v_referral_code text;
  v_requested_referral text;
  v_referrer_id uuid;
  v_referrer_code text;
  v_enforce_referral_system boolean;
begin
  if new.raw_user_meta_data ->> 'account_type' is distinct from 'patient' then
    return new;
  end if;

  select settings.enforce_referral_system
    into v_enforce_referral_system
    from public.platform_settings as settings
    order by settings.id
    limit 1;

  if not found then
    raise exception 'Platform settings are not configured';
  end if;

  v_phone_digits := pg_catalog.regexp_replace(
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone', ''),
    '[^0-9]',
    '',
    'g'
  );
  v_phone_suffix := pg_catalog.right('0000' || v_phone_digits, 4);
  v_requested_referral := nullif(
    pg_catalog.upper(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'referred_by', ''))),
    ''
  );

  if v_enforce_referral_system and v_requested_referral is not null then
    select patient.id, patient.referral_code
      into v_referrer_id, v_referrer_code
      from public.patients as patient
      where patient.id <> new.id
        and pg_catalog.upper(patient.referral_code) = v_requested_referral
      order by patient.id
      limit 1
      for update;

    if v_referrer_id is null then
      raise exception 'The referral code is invalid.';
    end if;
  end if;

  loop
    v_referral_code := v_phone_suffix || pg_catalog.upper(
      pg_catalog.substr(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        1,
        6
      )
    );

    insert into public.patients (
      id,
      referral_code,
      referred_by,
      free_tokens_balance
    )
    values (
      new.id,
      v_referral_code,
      v_referrer_code,
      2
    )
    on conflict (referral_code) do nothing;

    exit when found;
  end loop;

  if v_referrer_id is not null then
    update public.patients as patient
    set free_tokens_balance = patient.free_tokens_balance + 2
    where patient.id = v_referrer_id;
  end if;

  return new;
end;
$$;

revoke all on function public.create_patient_profile_for_auth_user()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

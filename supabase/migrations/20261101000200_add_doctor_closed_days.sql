alter table public.doctors
  add column if not exists weekly_off_days text[] not null default '{}';

alter table public.doctors
  add column if not exists opd_holiday_dates date[] not null default '{}';

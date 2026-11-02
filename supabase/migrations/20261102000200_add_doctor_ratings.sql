alter table public.tickets
  add column if not exists rating integer
  check (rating is null or rating between 1 and 5);

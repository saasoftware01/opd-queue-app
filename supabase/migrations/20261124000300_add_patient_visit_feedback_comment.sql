alter table public.tickets
  add column if not exists rating_comment text
  check (rating_comment is null or char_length(rating_comment) <= 2000);

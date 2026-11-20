create table if not exists public.whatsapp_incoming_messages (
  whatsapp_message_id text primary key,
  sender_phone text not null check (sender_phone ~ '^[0-9]{5,20}$'),
  sender_name text,
  message_text text not null check (char_length(message_text) <= 4096),
  received_at timestamptz not null default now()
);

create index if not exists whatsapp_incoming_messages_received_at_idx
  on public.whatsapp_incoming_messages (received_at desc);

alter table public.whatsapp_incoming_messages enable row level security;

revoke all on table public.whatsapp_incoming_messages
  from public, anon, authenticated;
grant all on table public.whatsapp_incoming_messages
  to service_role;

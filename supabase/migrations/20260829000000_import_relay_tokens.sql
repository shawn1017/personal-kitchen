create table if not exists public.import_relay_tokens (
  token_hash text primary key,
  source_url text not null check (source_url ~ '^https?://'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.import_relay_tokens enable row level security;

revoke all on table public.import_relay_tokens from anon, authenticated;

create index if not exists import_relay_tokens_expires_at_idx
  on public.import_relay_tokens (expires_at);

comment on table public.import_relay_tokens is
  'Short-lived, server-only image relay tokens for the Personal Kitchen import service. No recipe, order, or user data is stored here.';

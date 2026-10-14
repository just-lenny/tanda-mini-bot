create table if not exists public.tanda_sessions (
  session_id text primary key,
  phone text not null,
  creds jsonb not null default '{}'::jsonb,
  keys jsonb not null default '{}'::jsonb,
  connected boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.tanda_sessions enable row level security;

revoke all on table public.tanda_sessions from anon, authenticated;
grant all on table public.tanda_sessions to service_role;

create index if not exists tanda_sessions_phone_idx
  on public.tanda_sessions (phone);

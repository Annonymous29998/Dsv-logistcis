-- Live support inbox shared by homepage widget + admin Help & Support.

create table if not exists public.support_chats (
  id text primary key,
  name text not null default 'Website Visitor',
  unread_admin integer not null default 0,
  unread_customer integer not null default 0,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_chats_updated_at_idx on public.support_chats (updated_at desc);

alter table public.support_chats enable row level security;

drop policy if exists "Anon read support chats for realtime" on public.support_chats;
create policy "Anon read support chats for realtime"
  on public.support_chats
  for select
  to anon, authenticated
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.support_chats;
exception
  when duplicate_object then null;
  when others then null;
end $$;

comment on table public.support_chats is
  'Customer support threads. Writes go through server APIs; anon SELECT enables realtime refresh.';

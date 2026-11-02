-- If you already ran the older schema.sql, run this patch instead of recreating the table.

alter table public.shipments
  add column if not exists previous_status text,
  add column if not exists status_reason text,
  add column if not exists hold_reason text,
  add column if not exists cancel_reason text,
  add column if not exists held_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists admin_events jsonb not null default '[]'::jsonb;

alter table public.shipments enable row level security;

drop policy if exists "Anon read shipments for realtime" on public.shipments;
create policy "Anon read shipments for realtime"
  on public.shipments
  for select
  to anon, authenticated
  using (true);

-- Ignore error if already added
do $$
begin
  alter publication supabase_realtime add table public.shipments;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- DSV logistics trackings on Supabase Postgres
-- Covers: create, public track-by-id, edit, hold (+ reason), cancel (+ reason), delete, realtime.

create extension if not exists "pgcrypto";

create table if not exists public.shipments (
  id text primary key,

  status text not null default 'in-transit'
    check (status in (
      'pending',
      'in-transit',
      'out-for-delivery',
      'delivered',
      'on-hold',
      'cancelled',
      'exception'
    )),
  delivery_status text,
  previous_status text,

  status_reason text,
  hold_reason text,
  cancel_reason text,
  held_at timestamptz,
  cancelled_at timestamptz,

  out_for_delivery_today boolean default false,
  service_type text default 'DSV Road',
  estimated_delivery text,
  delivery_time text default '9:00 PM',

  sender text not null,
  receiver text not null,
  package_content text,
  signature_required boolean default true,

  from_location text not null,
  to_location text not null,
  status_near_place text,
  label_created_date text,
  delivery_notice jsonb,

  timeline jsonb not null default '[]'::jsonb,
  route_stops jsonb not null default '[]'::jsonb,
  planned_events jsonb not null default '[]'::jsonb,

  from_lat double precision,
  from_lon double precision,
  to_lat double precision,
  to_lon double precision,
  route_distance_m double precision,
  route_duration_s double precision,

  admin_events jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  eta_at timestamptz,
  progress_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.shipments
  add column if not exists previous_status text,
  add column if not exists status_reason text,
  add column if not exists hold_reason text,
  add column if not exists cancel_reason text,
  add column if not exists held_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists admin_events jsonb;

update public.shipments set admin_events = '[]'::jsonb where admin_events is null;
alter table public.shipments alter column admin_events set default '[]'::jsonb;
alter table public.shipments alter column admin_events set not null;

create index if not exists shipments_status_idx on public.shipments (status);
create index if not exists shipments_created_at_idx on public.shipments (created_at desc);
create index if not exists shipments_receiver_idx on public.shipments (receiver);

create or replace function public.set_shipments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
before update on public.shipments
for each row execute function public.set_shipments_updated_at();

alter table public.shipments enable row level security;

drop policy if exists "Public can read shipments by id" on public.shipments;
drop policy if exists "Anon read shipments for realtime" on public.shipments;
create policy "Anon read shipments for realtime"
  on public.shipments
  for select
  to anon, authenticated
  using (true);

-- No direct anon/authenticated writes. Admin mutations go through server APIs (service role).
drop policy if exists "No direct client writes on shipments" on public.shipments;

do $$
begin
  alter publication supabase_realtime add table public.shipments;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- Sole dashboard admin profile (Auth user is created separately; this gates identity).
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'administrator',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "Admins can read own admin row" on public.admin_users;
create policy "Admins can read own admin row"
  on public.admin_users
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.shipments is
  'Package trackings. Admin creates/edits/holds/cancels/deletes via server API. Customers track by id via /api/tracking/:id with realtime refresh.';

comment on table public.admin_users is
  'Allow-list of dashboard admins. Only listed Auth users may operate the admin portal.';

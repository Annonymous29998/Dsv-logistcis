-- DSV logistics trackings on Supabase Postgres
-- Run this once in the Supabase SQL Editor.
-- Covers: create, public track-by-id, edit, hold (+ reason), cancel (+ reason), delete.

create extension if not exists "pgcrypto";

create table if not exists public.shipments (
  -- Tracking number shown to customers (also the primary key)
  id text primary key,

  -- Operational status
  -- pending | in-transit | out-for-delivery | delivered | on-hold | cancelled | exception
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

  -- Hold / cancel / exception messaging (visible on public tracking)
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

  -- History the customer sees when they track
  timeline jsonb not null default '[]'::jsonb,

  -- Route plan used to auto-advance travel history
  route_stops jsonb not null default '[]'::jsonb,
  planned_events jsonb not null default '[]'::jsonb,

  from_lat double precision,
  from_lon double precision,
  to_lat double precision,
  to_lon double precision,
  route_distance_m double precision,
  route_duration_s double precision,

  -- Admin audit trail: [{at, action, reason, by}]
  admin_events jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  eta_at timestamptz,
  progress_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

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

-- Service role (server APIs) bypasses RLS for writes.
-- Anon SELECT is allowed so Supabase Realtime can push live updates to open tracking pages.
-- Customers still load full details through /api/tracking/:id; realtime only triggers refresh.
alter table public.shipments enable row level security;

drop policy if exists "Public can read shipments by id" on public.shipments;
drop policy if exists "Anon read shipments for realtime" on public.shipments;
create policy "Anon read shipments for realtime"
  on public.shipments
  for select
  to anon, authenticated
  using (true);

-- Enable live postgres changes for admin dashboard + public tracking pages
alter publication supabase_realtime add table public.shipments;

comment on table public.shipments is
  'Package trackings. Admin creates/edits/holds/cancels/deletes via server API. Customers track by id via /api/tracking/:id with realtime refresh.';

comment on column public.shipments.id is 'Customer-facing tracking number';
comment on column public.shipments.hold_reason is 'Why the shipment is on hold (shown on tracking page)';
comment on column public.shipments.cancel_reason is 'Why the shipment was cancelled (shown on tracking page)';
comment on column public.shipments.previous_status is 'Status before hold, used when releasing hold';
comment on column public.shipments.admin_events is 'Audit log of admin actions';

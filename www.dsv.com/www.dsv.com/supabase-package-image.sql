-- Optional: dedicated column for package photos (fallback already uses delivery_notice JSON).
alter table public.shipments
  add column if not exists package_image text;

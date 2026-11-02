-- Allow label-created as a first-class shipment status (matches Node/Python statusMeta).

alter table public.shipments drop constraint if exists shipments_status_check;

alter table public.shipments
  add constraint shipments_status_check
  check (status in (
    'pending',
    'label-created',
    'in-transit',
    'out-for-delivery',
    'delivered',
    'on-hold',
    'cancelled',
    'exception'
  ));

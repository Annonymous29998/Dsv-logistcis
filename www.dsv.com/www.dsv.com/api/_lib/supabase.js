const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    err.status = 500;
    throw err;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function rowToShipment(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    deliveryStatus: row.delivery_status,
    previousStatus: row.previous_status,
    statusReason: row.status_reason,
    holdReason: row.hold_reason,
    cancelReason: row.cancel_reason,
    heldAt: row.held_at,
    cancelledAt: row.cancelled_at,
    outForDeliveryToday: !!row.out_for_delivery_today,
    serviceType: row.service_type,
    estimatedDelivery: row.estimated_delivery,
    deliveryTime: row.delivery_time,
    sender: row.sender,
    receiver: row.receiver,
    packageContent: row.package_content,
    signatureRequired: !!row.signature_required,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    statusNearPlace: row.status_near_place,
    labelCreatedDate: row.label_created_date,
    deliveryNotice: row.delivery_notice,
    timeline: row.timeline || [],
    routeStops: row.route_stops || [],
    plannedEvents: row.planned_events || [],
    adminEvents: row.admin_events || [],
    fromLat: row.from_lat,
    fromLon: row.from_lon,
    toLat: row.to_lat,
    toLon: row.to_lon,
    routeDistanceM: row.route_distance_m,
    routeDurationS: row.route_duration_s,
    createdAt: row.created_at,
    etaAt: row.eta_at,
    progressUpdatedAt: row.progress_updated_at
  };
}

function shipmentToRow(id, item) {
  return {
    id,
    status: item.status || "in-transit",
    delivery_status: item.deliveryStatus || null,
    previous_status: item.previousStatus || null,
    status_reason: item.statusReason || null,
    hold_reason: item.holdReason || null,
    cancel_reason: item.cancelReason || null,
    held_at: item.heldAt || null,
    cancelled_at: item.cancelledAt || null,
    out_for_delivery_today: !!item.outForDeliveryToday,
    service_type: item.serviceType || "DSV Road",
    estimated_delivery: item.estimatedDelivery || null,
    delivery_time: item.deliveryTime || "9:00 PM",
    sender: item.sender,
    receiver: item.receiver,
    package_content: item.packageContent || null,
    signature_required: item.signatureRequired !== false,
    from_location: item.fromLocation,
    to_location: item.toLocation,
    status_near_place: item.statusNearPlace || null,
    label_created_date: item.labelCreatedDate || null,
    delivery_notice: item.deliveryNotice || null,
    timeline: item.timeline || [],
    route_stops: item.routeStops || [],
    planned_events: item.plannedEvents || [],
    admin_events: item.adminEvents || [],
    from_lat: item.fromLat ?? null,
    from_lon: item.fromLon ?? null,
    to_lat: item.toLat ?? null,
    to_lon: item.toLon ?? null,
    route_distance_m: item.routeDistanceM ?? null,
    route_duration_s: item.routeDurationS ?? null,
    created_at: item.createdAt || new Date().toISOString(),
    eta_at: item.etaAt || null,
    progress_updated_at: item.progressUpdatedAt || null
  };
}

function publicShipment(item) {
  if (!item) return null;
  const {
    plannedEvents,
    adminEvents,
    createdAt,
    etaAt,
    progressUpdatedAt,
    previousStatus,
    ...publicFields
  } = item;
  return publicFields;
}

function adminShipment(item) {
  if (!item) return null;
  const { plannedEvents, adminEvents, routeGeometry, ...adminFields } = item;
  return adminFields;
}

module.exports = { getSupabase, rowToShipment, shipmentToRow, publicShipment, adminShipment };

const { getSupabase, rowToShipment, shipmentToRow, publicShipment, adminShipment } = require("./supabase");
const {
  geocodeAddress,
  buildRoutePlan,
  timelineForStatus,
  statusMeta
} = require("./geo");

function generateTrackingId() {
  let id = "";
  for (let i = 0; i < 12; i += 1) id += String(Math.floor(Math.random() * 10));
  return id;
}

function pushAdminEvent(item, action, reason) {
  const events = Array.isArray(item.adminEvents) ? item.adminEvents.slice() : [];
  events.push({
    at: new Date().toISOString(),
    action,
    reason: reason || null
  });
  item.adminEvents = events;
}

function stampNow() {
  const dt = new Date();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const year = dt.getFullYear();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month}/${day}/${year} ${hours}:${minutes} ${ampm}`;
}

function appendTimeline(item, title, location) {
  const timeline = Array.isArray(item.timeline) ? item.timeline.slice() : [];
  timeline.push({
    title,
    location: location || item.statusNearPlace || item.toLocation || "—",
    date: stampNow()
  });
  item.timeline = timeline;
}

function progressShipment(item) {
  const current = String(item.status || "").toLowerCase();
  if (current === "on-hold" || current === "cancelled" || current === "delivered") return false;

  const planned = item.plannedEvents || [];
  if (!planned.length || !item.createdAt || !item.etaAt) return false;

  const created = new Date(item.createdAt).getTime();
  const eta = new Date(item.etaAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(eta) || eta <= created) return false;

  const now = Date.now();
  const frac = Math.max(0, Math.min(1, (now - created) / (eta - created)));
  const visible = [];
  let currentTitle = "LABEL CREATED";
  for (const ev of planned) {
    if (Number(ev.fraction || 0) <= frac + 1e-9) {
      visible.push({ title: ev.title, location: ev.location, date: ev.date });
      currentTitle = ev.title || currentTitle;
    }
  }
  if (!visible.length) return false;
  // Don't shrink below admin-appended events; public UI hides future planned scans itself.
  if (visible.length < (item.timeline || []).length) return false;

  const title = String(currentTitle || "").toUpperCase();
  let status = "pending";
  let deliveryStatus = "Pending";
  if (title === "DELIVERED") {
    status = "delivered";
    deliveryStatus = "Delivered";
  } else if (title === "OUT FOR DELIVERY") {
    status = "out-for-delivery";
    deliveryStatus = "Out For Delivery";
  } else if (title === "IN TRANSIT" || title === "PACKAGE RECEIVED BY DSV") {
    status = "in-transit";
    deliveryStatus = "In Transit";
  }

  const rank = { pending: 0, "label-created": 0, "in-transit": 1, "out-for-delivery": 2, delivered: 3, exception: 1 };
  const oldRank = rank[String(item.status || "").toLowerCase()] || 0;
  const newRank = rank[status] || 0;

  let changed = false;
  if (JSON.stringify(item.timeline || []) !== JSON.stringify(visible)) {
    item.timeline = visible;
    changed = true;
  }
  if (newRank >= oldRank && item.status !== status) {
    item.status = status;
    changed = true;
  }
  if (newRank >= oldRank && item.deliveryStatus !== deliveryStatus) {
    item.deliveryStatus = deliveryStatus;
    changed = true;
  }

  const lastLoc = visible[visible.length - 1] && visible[visible.length - 1].location;
  if (lastLoc) {
    const near = String(lastLoc).replace(/^FROM\s+/i, "").split(",").slice(0, 2).map((s) => s.trim()).filter(Boolean).join(", ");
    if (near && item.statusNearPlace !== near) {
      item.statusNearPlace = near;
      changed = true;
    }
  }

  if (status === "out-for-delivery") item.outForDeliveryToday = true;
  else if (item.outForDeliveryToday) {
    item.outForDeliveryToday = false;
    changed = true;
  }

  if (changed) item.progressUpdatedAt = new Date().toISOString();
  return changed;
}

function hasCoords(item) {
  return [item.fromLat, item.fromLon, item.toLat, item.toLon].every((n) => Number.isFinite(Number(n)));
}

async function repairMissingCoordinates(item) {
  if (!item || hasCoords(item)) return false;
  const fromLocation = String(item.fromLocation || "").trim();
  const toLocation = String(item.toLocation || "").trim();
  if (!fromLocation || !toLocation) return false;
  const fromGeo = await geocodeAddress(fromLocation);
  const toGeo = await geocodeAddress(toLocation);
  if (!fromGeo || !toGeo) return false;
  item.fromLat = Number(fromGeo.lat);
  item.fromLon = Number(fromGeo.lon);
  item.toLat = Number(toGeo.lat);
  item.toLon = Number(toGeo.lon);
  if (fromGeo.label) item.fromLocation = fromGeo.label;
  if (toGeo.label) item.toLocation = toGeo.label;
  return true;
}

async function listShipments() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("shipments").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data || []).map(rowToShipment);
  const updates = [];
  for (const item of rows) {
    let changed = progressShipment(item);
    if (await repairMissingCoordinates(item)) changed = true;
    if (changed) updates.push(shipmentToRow(item.id, item));
  }
  if (updates.length) {
    await supabase.from("shipments").upsert(updates);
  }
  return rows;
}

function matchesTrackingId(candidate, needle) {
  const key = String(candidate || "").toUpperCase();
  const want = String(needle || "").trim().toUpperCase();
  if (!key || !want) return false;
  if (key === want) return true;
  if (/^\d+$/.test(want)) {
    const padded = want.length <= 6 ? want.padStart(6, "0") : want;
    return key.endsWith(padded);
  }
  return want.length >= 4 && key.endsWith(want);
}

async function getShipment(id) {
  const supabase = getSupabase();
  const raw = String(id || "").trim();
  let { data, error } = await supabase.from("shipments").select("*").eq("id", raw).maybeSingle();
  if (error) throw error;
  if (!data) {
    const all = await supabase.from("shipments").select("*");
    if (all.error) throw all.error;
    const rows = all.data || [];
    const exact = rows.find((row) => String(row.id).toUpperCase() === raw.toUpperCase());
    if (exact) {
      data = exact;
    } else {
      const soft = rows.filter((row) => matchesTrackingId(row.id, raw));
      data = soft.length === 1 ? soft[0] : null;
    }
  }
  if (!data) return null;
  const item = rowToShipment(data);
  if (progressShipment(item)) {
    await supabase.from("shipments").upsert(shipmentToRow(item.id, item));
  }
  return item;
}

async function createShipment(payload) {
  const sender = String(payload.sender || "").trim();
  const receiver = String(payload.receiver || "").trim();
  let fromLocation = String(payload.fromLocation || "").trim();
  let toLocation = String(payload.toLocation || "").trim();
  if (!sender || !receiver || !fromLocation || !toLocation) {
    const err = new Error("Sender, receiver, from, and to addresses are required.");
    err.status = 400;
    throw err;
  }

  let fromLat = payload.fromLat;
  let fromLon = payload.fromLon;
  let toLat = payload.toLat;
  let toLon = payload.toLon;

  if (fromLat == null || fromLon == null) {
    const geo = await geocodeAddress(fromLocation);
    if (!geo) {
      const err = new Error("Could not find the origin address on the map.");
      err.status = 400;
      throw err;
    }
    fromLat = geo.lat;
    fromLon = geo.lon;
    fromLocation = geo.label;
  }
  if (toLat == null || toLon == null) {
    const geo = await geocodeAddress(toLocation);
    if (!geo) {
      const err = new Error("Could not find the destination address on the map.");
      err.status = 400;
      throw err;
    }
    toLat = geo.lat;
    toLon = geo.lon;
    toLocation = geo.label;
  }

  const plan = await buildRoutePlan(
    fromLocation,
    toLocation,
    Number(fromLat),
    Number(fromLon),
    Number(toLat),
    Number(toLon),
    Number(payload.transitHours || 72)
  );

  const [status, deliveryStatus] = statusMeta(payload.status || "in-transit");
  const timeline = timelineForStatus(plan.plannedEvents, status);

  const supabase = getSupabase();
  let trackingId = String(payload.id || "").trim();
  if (trackingId) {
    if (!/^[A-Za-z0-9]{6,24}$/.test(trackingId)) {
      const err = new Error("Tracking ID must be 6–24 letters or digits.");
      err.status = 400;
      throw err;
    }
    const existing = await getShipment(trackingId);
    if (existing) {
      const err = new Error("That tracking ID already exists.");
      err.status = 400;
      throw err;
    }
  } else {
    for (let i = 0; i < 20; i += 1) {
      trackingId = generateTrackingId();
      const existing = await getShipment(trackingId);
      if (!existing) break;
    }
  }

  const item = {
    id: trackingId,
    status,
    deliveryStatus,
    serviceType: String(payload.serviceType || "DSV Road").trim() || "DSV Road",
    estimatedDelivery: plan.estimatedDelivery,
    deliveryTime: String(payload.deliveryTime || "9:00 PM").trim() || "9:00 PM",
    sender,
    receiver,
    packageContent: String(payload.packageContent || "General cargo").trim() || "General cargo",
    signatureRequired: payload.signatureRequired !== false,
    fromLocation,
    toLocation,
    statusNearPlace: plan.statusNearPlace,
    labelCreatedDate: plan.labelCreatedDate,
    timeline,
    fromLat: Number(fromLat),
    fromLon: Number(fromLon),
    toLat: Number(toLat),
    toLon: Number(toLon),
    routeStops: plan.routeStops,
    plannedEvents: plan.plannedEvents,
    createdAt: plan.createdAt,
    etaAt: plan.etaAt,
    routeDistanceM: plan.distanceM,
    routeDurationS: plan.durationS,
    outForDeliveryToday: status === "out-for-delivery",
    adminEvents: [{ at: plan.createdAt, action: "create", reason: null }]
  };

  const { error } = await supabase.from("shipments").insert(shipmentToRow(trackingId, item));
  if (error) throw error;
  return { id: trackingId, shipment: adminShipment(item) };
}

async function previewRoute(payload) {
  let fromLocation = String(payload.fromLocation || "").trim();
  let toLocation = String(payload.toLocation || "").trim();
  if (!fromLocation || !toLocation) {
    const err = new Error("From and to addresses are required.");
    err.status = 400;
    throw err;
  }

  let fromLat = payload.fromLat;
  let fromLon = payload.fromLon;
  let toLat = payload.toLat;
  let toLon = payload.toLon;

  if (fromLat == null || fromLon == null) {
    const geo = await geocodeAddress(fromLocation);
    if (!geo) {
      const err = new Error("Could not geocode origin.");
      err.status = 400;
      throw err;
    }
    fromLat = geo.lat;
    fromLon = geo.lon;
    fromLocation = geo.label;
  }
  if (toLat == null || toLon == null) {
    const geo = await geocodeAddress(toLocation);
    if (!geo) {
      const err = new Error("Could not geocode destination.");
      err.status = 400;
      throw err;
    }
    toLat = geo.lat;
    toLon = geo.lon;
    toLocation = geo.label;
  }

  const plan = await buildRoutePlan(
    fromLocation,
    toLocation,
    Number(fromLat),
    Number(fromLon),
    Number(toLat),
    Number(toLon),
    Number(payload.transitHours || 72)
  );

  return {
    fromLocation,
    toLocation,
    fromLat: Number(fromLat),
    fromLon: Number(fromLon),
    toLat: Number(toLat),
    toLon: Number(toLon),
    estimatedDelivery: plan.estimatedDelivery,
    distanceKm: Math.round((plan.distanceM / 1000) * 10) / 10,
    stops: plan.routeStops.map((s) => ({ label: s.label, kind: s.kind })),
    plannedEvents: plan.plannedEvents.map((e) => ({
      title: e.title,
      location: e.location,
      date: e.date
    }))
  };
}

async function updateShipment(id, payload) {
  const existing = await getShipment(id);
  if (!existing) {
    const err = new Error("Shipment not found.");
    err.status = 404;
    throw err;
  }
  if (String(existing.status).toLowerCase() === "cancelled") {
    const err = new Error("Cancelled shipments cannot be edited. Create a new tracking instead.");
    err.status = 400;
    throw err;
  }

  const editable = [
    "sender",
    "receiver",
    "packageContent",
    "serviceType",
    "deliveryTime",
    "estimatedDelivery",
    "signatureRequired",
    "statusNearPlace",
    "fromLocation",
    "toLocation"
  ];
  editable.forEach((key) => {
    if (payload[key] === undefined) return;
    if (key === "signatureRequired") {
      existing.signatureRequired = !!payload.signatureRequired;
      return;
    }
    existing[key] = payload[key];
  });

  if (payload.status) {
    const [status, deliveryStatus] = statusMeta(payload.status);
    if (status === "on-hold" || status === "cancelled") {
      const err = new Error("Use the hold or cancel actions to change to those statuses.");
      err.status = 400;
      throw err;
    }
    existing.status = status;
    existing.deliveryStatus = deliveryStatus;
    if (status === "out-for-delivery") existing.outForDeliveryToday = true;
  }

  const coordKeys = ["fromLat", "fromLon", "toLat", "toLon"];
  const coordsProvided = coordKeys.some((k) => payload[k] != null);
  let routeChanged = false;
  if (coordsProvided) {
    const next = {
      fromLat: payload.fromLat != null ? Number(payload.fromLat) : Number(existing.fromLat),
      fromLon: payload.fromLon != null ? Number(payload.fromLon) : Number(existing.fromLon),
      toLat: payload.toLat != null ? Number(payload.toLat) : Number(existing.toLat),
      toLon: payload.toLon != null ? Number(payload.toLon) : Number(existing.toLon)
    };
    if (coordKeys.some((k) => !Number.isFinite(next[k]))) {
      const err = new Error("Invalid map coordinates for origin/destination.");
      err.status = 400;
      throw err;
    }
    coordKeys.forEach((k) => {
      if (Math.abs(Number(existing[k] || 0) - next[k]) > 1e-6) routeChanged = true;
      existing[k] = next[k];
    });
  }

  if (routeChanged) {
    const plan = await buildRoutePlan(
      String(existing.fromLocation || ""),
      String(existing.toLocation || ""),
      Number(existing.fromLat),
      Number(existing.fromLon),
      Number(existing.toLat),
      Number(existing.toLon),
      Number(payload.transitHours || 72)
    );
    existing.routeStops = plan.routeStops;
    existing.plannedEvents = plan.plannedEvents;
    existing.statusNearPlace = plan.statusNearPlace;
    existing.routeDistanceM = plan.distanceM;
    existing.routeDurationS = plan.durationS;
    existing.etaAt = plan.etaAt;
    if (!payload.estimatedDelivery) existing.estimatedDelivery = plan.estimatedDelivery;
    // Keep existing scan/admin timeline; only refresh planned future events.
  }

  pushAdminEvent(existing, "edit", payload.reason || "Shipment details updated");
  appendTimeline(existing, "DETAILS UPDATED", payload.reason || "Shipment details updated");
  const supabase = getSupabase();
  const { error } = await supabase.from("shipments").upsert(shipmentToRow(existing.id, existing));
  if (error) {
    const err = new Error(error.message || "Could not save shipment changes.");
    err.status = 500;
    throw err;
  }
  return { id: existing.id, shipment: adminShipment(existing) };
}

async function holdShipment(id, reason) {
  const why = String(reason || "").trim();
  if (!why) {
    const err = new Error("A hold reason is required.");
    err.status = 400;
    throw err;
  }
  const existing = await getShipment(id);
  if (!existing) {
    const err = new Error("Shipment not found.");
    err.status = 404;
    throw err;
  }
  const current = String(existing.status || "").toLowerCase();
  if (current === "cancelled") {
    const err = new Error("Cannot hold a cancelled shipment.");
    err.status = 400;
    throw err;
  }
  if (current === "delivered") {
    const err = new Error("Cannot hold a delivered shipment.");
    err.status = 400;
    throw err;
  }
  if (current !== "on-hold") {
    existing.previousStatus = existing.status;
  }
  existing.status = "on-hold";
  existing.deliveryStatus = "On Hold";
  existing.holdReason = why;
  existing.statusReason = why;
  existing.heldAt = new Date().toISOString();
  existing.outForDeliveryToday = false;
  appendTimeline(existing, "ON HOLD", why);
  pushAdminEvent(existing, "hold", why);

  const supabase = getSupabase();
  const { error } = await supabase.from("shipments").upsert(shipmentToRow(existing.id, existing));
  if (error) {
    const err = new Error(error.message || "Could not place shipment on hold.");
    err.status = 500;
    throw err;
  }
  return { id: existing.id, shipment: adminShipment(existing) };
}

async function releaseHold(id, note) {
  const existing = await getShipment(id);
  if (!existing) {
    const err = new Error("Shipment not found.");
    err.status = 404;
    throw err;
  }
  if (String(existing.status).toLowerCase() !== "on-hold") {
    const err = new Error("Shipment is not on hold.");
    err.status = 400;
    throw err;
  }
  const resume = existing.previousStatus || "in-transit";
  const [status, deliveryStatus] = statusMeta(resume);
  existing.status = status;
  existing.deliveryStatus = deliveryStatus;
  existing.previousStatus = null;
  existing.holdReason = null;
  existing.statusReason = note || null;
  existing.heldAt = null;
  appendTimeline(existing, "HOLD RELEASED", note || "Shipment released from hold");
  pushAdminEvent(existing, "release-hold", note || null);

  const supabase = getSupabase();
  const { error } = await supabase.from("shipments").upsert(shipmentToRow(existing.id, existing));
  if (error) {
    const err = new Error(error.message || "Could not release hold.");
    err.status = 500;
    throw err;
  }
  return { id: existing.id, shipment: adminShipment(existing) };
}

async function cancelShipment(id, reason) {
  const why = String(reason || "").trim();
  if (!why) {
    const err = new Error("A cancel reason is required.");
    err.status = 400;
    throw err;
  }
  const existing = await getShipment(id);
  if (!existing) {
    const err = new Error("Shipment not found.");
    err.status = 404;
    throw err;
  }
  if (String(existing.status).toLowerCase() === "delivered") {
    const err = new Error("Delivered shipments cannot be cancelled.");
    err.status = 400;
    throw err;
  }
  existing.status = "cancelled";
  existing.deliveryStatus = "Cancelled";
  existing.cancelReason = why;
  existing.statusReason = why;
  existing.cancelledAt = new Date().toISOString();
  existing.outForDeliveryToday = false;
  existing.holdReason = null;
  existing.heldAt = null;
  appendTimeline(existing, "CANCELLED", why);
  pushAdminEvent(existing, "cancel", why);

  const supabase = getSupabase();
  const { error } = await supabase.from("shipments").upsert(shipmentToRow(existing.id, existing));
  if (error) {
    const err = new Error(error.message || "Could not cancel shipment.");
    err.status = 500;
    throw err;
  }
  return { id: existing.id, shipment: adminShipment(existing) };
}

async function deleteShipment(id) {
  const existing = await getShipment(id);
  if (!existing) {
    const err = new Error("Shipment not found.");
    err.status = 404;
    throw err;
  }
  const supabase = getSupabase();
  const { error } = await supabase.from("shipments").delete().eq("id", existing.id);
  if (error) throw error;
  return { id: existing.id, deleted: true };
}

async function clearAllShipments() {
  const supabase = getSupabase();
  const { data, error: listError } = await supabase.from("shipments").select("id");
  if (listError) {
    const err = new Error(listError.message || "Could not list shipments to clear.");
    err.status = 500;
    throw err;
  }
  const ids = (data || []).map((row) => row.id).filter(Boolean);
  if (!ids.length) return { deleted: 0, shipments: [] };

  const { error } = await supabase.from("shipments").delete().in("id", ids);
  if (error) {
    const err = new Error(error.message || "Could not clear shipments.");
    err.status = 500;
    throw err;
  }
  return { deleted: ids.length, shipments: [] };
}

module.exports = {
  listShipments,
  getShipment,
  createShipment,
  updateShipment,
  holdShipment,
  releaseHold,
  cancelShipment,
  deleteShipment,
  clearAllShipments,
  previewRoute,
  publicShipment,
  adminShipment
};

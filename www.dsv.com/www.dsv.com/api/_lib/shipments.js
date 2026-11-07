const {
  getSupabase,
  rowToShipment,
  shipmentToRow,
  publicShipment,
  adminShipment,
  shipmentHasPackageImage,
  packageImagePayload
} = require("./supabase");
const {
  geocodeAddress,
  buildRoutePlan,
  timelineForStatus,
  statusMeta,
  formatStamp,
  formatEta
} = require("./geo");

// Optional column — if SQL migration was not run, strip it and keep image in delivery_notice.
let packageImageColumnMissing = false;

function isMissingPackageImageColumn(error) {
  return /package_image/i.test(String((error && error.message) || error || ""));
}

function nestPackageImageInNotice(row, item) {
  if (!item || !item.packageImage) return;
  const notice =
    row.delivery_notice && typeof row.delivery_notice === "object"
      ? Object.assign({}, row.delivery_notice)
      : {};
  notice.packageImage = item.packageImage;
  row.delivery_notice = notice;
}

async function saveShipmentRow(id, item, mode) {
  const supabase = getSupabase();
  const row = shipmentToRow(id, item);
  if (packageImageColumnMissing) {
    delete row.package_image;
    nestPackageImageInNotice(row, item);
  } else if (row.delivery_notice && typeof row.delivery_notice === "object") {
    // Column is available — drop nested base64 so JSONB stays small.
    delete row.delivery_notice.packageImage;
    if (!Object.keys(row.delivery_notice).length) row.delivery_notice = null;
  }

  let result =
    mode === "insert"
      ? await supabase.from("shipments").insert(row)
      : await supabase.from("shipments").upsert(row);

  if (result.error && isMissingPackageImageColumn(result.error)) {
    packageImageColumnMissing = true;
    delete row.package_image;
    nestPackageImageInNotice(row, item);
    result =
      mode === "insert"
        ? await supabase.from("shipments").insert(row)
        : await supabase.from("shipments").upsert(row);
  }
  return result.error || null;
}

/**
 * Status/timeline updates only — never re-upload package_image (large data URLs break hold/cancel).
 * options.progressOnly: refuse to overwrite admin hold/cancel/delivered (fixes race with live polling).
 */
async function patchShipmentStatus(id, item, options) {
  options = options || {};
  const supabase = getSupabase();
  const full = shipmentToRow(id, item);
  // Keep holdPausedMs updates. Prefer package_image column; only nest base64
  // into delivery_notice when that column is known missing.
  let deliveryNotice = full.delivery_notice;
  if (deliveryNotice && typeof deliveryNotice === "object") {
    deliveryNotice = Object.assign({}, deliveryNotice);
    if (packageImageColumnMissing && item.packageImage) {
      deliveryNotice.packageImage = item.packageImage;
    } else {
      delete deliveryNotice.packageImage;
    }
    if (!Object.keys(deliveryNotice).length) deliveryNotice = null;
  }
  const patch = {
    status: full.status,
    delivery_status: full.delivery_status,
    previous_status: full.previous_status,
    status_reason: full.status_reason,
    hold_reason: full.hold_reason,
    cancel_reason: full.cancel_reason,
    held_at: full.held_at,
    cancelled_at: full.cancelled_at,
    out_for_delivery_today: full.out_for_delivery_today,
    status_near_place: full.status_near_place,
    timeline: full.timeline,
    planned_events: full.planned_events,
    admin_events: full.admin_events,
    delivery_notice: deliveryNotice,
    eta_at: full.eta_at,
    progress_updated_at: full.progress_updated_at,
    estimated_delivery: full.estimated_delivery
  };
  let query = supabase.from("shipments").update(patch).eq("id", id);
  if (options.progressOnly) {
    query = query.in("status", [
      "pending",
      "label-created",
      "in-transit",
      "out-for-delivery",
      "exception"
    ]);
  }
  const { error } = await query;
  return error || null;
}

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

function isAdminTimelineEvent(ev) {
  const title = String((ev && ev.title) || "").toUpperCase().trim();
  if (!title) return false;
  return (
    title === "ON HOLD" ||
    title === "HOLD RELEASED" ||
    title === "CANCELLED" ||
    title === "DETAILS UPDATED" ||
    title.indexOf("HOLD") === 0 ||
    title.indexOf("CANCEL") === 0
  );
}

function parseTimelineStamp(value) {
  const raw = String(value || "").trim();
  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!match) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const ampm = match[6].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return Date.UTC(
    Number(match[3]),
    Number(match[1]) - 1,
    Number(match[2]),
    hour,
    minute
  );
}

function mergePlannedWithAdminTimeline(plannedVisible, existingTimeline) {
  const adminEvents = (existingTimeline || []).filter(isAdminTimelineEvent);
  if (!adminEvents.length) return plannedVisible.slice();
  return plannedVisible
    .concat(adminEvents)
    .sort(function (a, b) {
      const da = parseTimelineStamp(a && a.date);
      const db = parseTimelineStamp(b && b.date);
      if (da !== db) return da - db;
      // Keep planned scans ahead of same-minute admin notes when stamps collide.
      const aAdmin = isAdminTimelineEvent(a) ? 1 : 0;
      const bAdmin = isAdminTimelineEvent(b) ? 1 : 0;
      return aAdmin - bAdmin;
    });
}

function getHoldPausedMs(item) {
  const direct = Number(item && item.holdPausedMs);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const notice = item && item.deliveryNotice;
  if (notice && typeof notice === "object") {
    const nested = Number(notice.holdPausedMs || 0);
    if (Number.isFinite(nested) && nested > 0) return nested;
  }
  return 0;
}

function setHoldPausedMs(item, ms) {
  const value = Math.max(0, Number(ms) || 0);
  item.holdPausedMs = value;
  if (!item.deliveryNotice || typeof item.deliveryNotice !== "object") {
    item.deliveryNotice = {};
  } else {
    item.deliveryNotice = Object.assign({}, item.deliveryNotice);
  }
  if (value > 0) item.deliveryNotice.holdPausedMs = value;
  else delete item.deliveryNotice.holdPausedMs;
}

function routeProgressFraction(item) {
  const created = Date.parse(item && item.createdAt);
  const eta = Date.parse(item && item.etaAt);
  if (!Number.isFinite(created) || !Number.isFinite(eta) || eta <= created) return null;
  const paused = getHoldPausedMs(item);
  const status = String((item && item.status) || "").toLowerCase();
  let end = Date.now();
  if (status === "on-hold") {
    const held = Date.parse(item && item.heldAt);
    end = Number.isFinite(held) ? held : end;
  }
  const elapsed = Math.max(0, end - created - paused);
  const total = Math.max(1, eta - created - paused);
  return Math.max(0, Math.min(1, elapsed / total));
}

function shiftPlanAfterHold(item, pauseMs) {
  if (!pauseMs || pauseMs <= 0) return;
  const etaMs = Date.parse(item.etaAt);
  if (Number.isFinite(etaMs)) {
    const nextEta = new Date(etaMs + pauseMs);
    item.etaAt = nextEta.toISOString();
    item.estimatedDelivery = formatEta(nextEta);
  }
  item.plannedEvents = (item.plannedEvents || []).map(function (ev) {
    const copy = Object.assign({}, ev);
    const atMs = Date.parse(copy.at || "");
    if (Number.isFinite(atMs)) {
      const next = new Date(atMs + pauseMs);
      copy.at = next.toISOString();
      copy.date = formatStamp(next);
    } else {
      const stampMs = parseTimelineStamp(copy.date);
      if (stampMs) {
        const next = new Date(stampMs + pauseMs);
        copy.date = formatStamp(next);
        copy.at = next.toISOString();
      }
    }
    return copy;
  });
}

function progressShipment(item) {
  const current = String(item.status || "").toLowerCase();
  if (current === "on-hold" || current === "cancelled" || current === "delivered") return false;

  const planned = item.plannedEvents || [];
  if (!planned.length || !item.createdAt || !item.etaAt) return false;

  const created = new Date(item.createdAt).getTime();
  const eta = new Date(item.etaAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(eta) || eta <= created) return false;

  const fracRaw = routeProgressFraction(item);
  const frac = fracRaw == null ? 0 : fracRaw;
  const visible = [];
  let currentTitle = "LABEL CREATED";
  for (const ev of planned) {
    if (Number(ev.fraction || 0) <= frac + 1e-9) {
      visible.push({ title: ev.title, location: ev.location, date: ev.date });
      currentTitle = ev.title || currentTitle;
    }
  }
  if (!visible.length) return false;

  // Keep admin hold/cancel notes, but still advance due planned scans.
  // Old logic refused to progress whenever timeline grew longer than the plan
  // (e.g. after Place on hold), which permanently froze transit updates.
  const merged = mergePlannedWithAdminTimeline(visible, item.timeline || []);

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
  if (JSON.stringify(item.timeline || []) !== JSON.stringify(merged)) {
    item.timeline = merged;
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

function parseCoord(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasCoords(item) {
  // Number(null) === 0, so reject null/empty explicitly — otherwise Null Island "coords"
  // skip repair and hide real addresses from the map.
  return [item.fromLat, item.fromLon, item.toLat, item.toLon].every((n) => parseCoord(n) != null);
}

async function patchShipmentCoordinates(id, item) {
  const supabase = getSupabase();
  const full = shipmentToRow(id, item);
  const { error } = await supabase
    .from("shipments")
    .update({
      from_lat: full.from_lat,
      from_lon: full.from_lon,
      to_lat: full.to_lat,
      to_lon: full.to_lon,
      from_location: full.from_location,
      to_location: full.to_location,
      route_stops: full.route_stops,
      planned_events: full.planned_events,
      status_near_place: full.status_near_place,
      route_distance_m: full.route_distance_m,
      route_duration_s: full.route_duration_s,
      eta_at: full.eta_at,
      estimated_delivery: full.estimated_delivery,
      label_created_date: full.label_created_date
    })
    .eq("id", id);
  return error || null;
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

  try {
    const plan = await buildRoutePlan(
      item.fromLocation,
      item.toLocation,
      item.fromLat,
      item.fromLon,
      item.toLat,
      item.toLon,
      72
    );
    if (!Array.isArray(item.routeStops) || item.routeStops.length < 2) {
      item.routeStops = plan.routeStops;
    }
    if (!Array.isArray(item.plannedEvents) || !item.plannedEvents.length) {
      item.plannedEvents = plan.plannedEvents;
    }
    if (!item.statusNearPlace) item.statusNearPlace = plan.statusNearPlace;
    if (!item.etaAt) item.etaAt = plan.etaAt;
    if (!item.estimatedDelivery) item.estimatedDelivery = plan.estimatedDelivery;
    if (!item.labelCreatedDate) item.labelCreatedDate = plan.labelCreatedDate;
    item.routeDistanceM = plan.distanceM;
    item.routeDurationS = plan.durationS;
  } catch (_err) {
    item.routeStops = [
      { lat: item.fromLat, lon: item.fromLon, label: item.fromLocation, kind: "origin" },
      { lat: item.toLat, lon: item.toLon, label: item.toLocation, kind: "destination" }
    ];
  }
  return true;
}

async function listShipments() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("shipments").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data || []).map(rowToShipment);
  for (const item of rows) {
    const changed = progressShipment(item);
    if (await repairMissingCoordinates(item)) {
      await patchShipmentCoordinates(item.id, item);
    }
    if (changed) {
      // Patch status fields only — never clobber hold/cancel via concurrent polls.
      await patchShipmentStatus(item.id, item, { progressOnly: true });
    }
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
  if (await repairMissingCoordinates(item)) {
    await patchShipmentCoordinates(item.id, item);
  }
  if (progressShipment(item)) {
    await patchShipmentStatus(item.id, item, { progressOnly: true });
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

  let fromLat = parseCoord(payload.fromLat);
  let fromLon = parseCoord(payload.fromLon);
  let toLat = parseCoord(payload.toLat);
  let toLon = parseCoord(payload.toLon);

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
    fromLat,
    fromLon,
    toLat,
    toLon,
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

  const packageImageRaw = String(payload.packageImage || "");
  const packageImage =
    packageImageRaw.indexOf("data:image/") === 0 && packageImageRaw.length <= 1400000
      ? packageImageRaw
      : null;

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
    packageImage,
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

  const error = await saveShipmentRow(trackingId, item, "insert");
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

  let fromLat = parseCoord(payload.fromLat);
  let fromLon = parseCoord(payload.fromLon);
  let toLat = parseCoord(payload.toLat);
  let toLon = parseCoord(payload.toLon);

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
  const coordsProvided = coordKeys.some((k) => parseCoord(payload[k]) != null);
  let routeChanged = false;
  if (coordsProvided) {
    const next = {
      fromLat: parseCoord(payload.fromLat) != null ? parseCoord(payload.fromLat) : parseCoord(existing.fromLat),
      fromLon: parseCoord(payload.fromLon) != null ? parseCoord(payload.fromLon) : parseCoord(existing.fromLon),
      toLat: parseCoord(payload.toLat) != null ? parseCoord(payload.toLat) : parseCoord(existing.toLat),
      toLon: parseCoord(payload.toLon) != null ? parseCoord(payload.toLon) : parseCoord(existing.toLon)
    };
    if (coordKeys.some((k) => next[k] == null)) {
      const err = new Error("Invalid map coordinates for origin/destination.");
      err.status = 400;
      throw err;
    }
    coordKeys.forEach((k) => {
      if (Math.abs(Number(existing[k] || 0) - next[k]) > 1e-6) routeChanged = true;
      existing[k] = next[k];
    });
  } else if (!hasCoords(existing)) {
    // Fill missing pins so the map can show the shipment.
    const fromGeo = await geocodeAddress(String(existing.fromLocation || ""));
    const toGeo = await geocodeAddress(String(existing.toLocation || ""));
    if (fromGeo && toGeo) {
      existing.fromLat = Number(fromGeo.lat);
      existing.fromLon = Number(fromGeo.lon);
      existing.toLat = Number(toGeo.lat);
      existing.toLon = Number(toGeo.lon);
      if (fromGeo.label) existing.fromLocation = fromGeo.label;
      if (toGeo.label) existing.toLocation = toGeo.label;
      routeChanged = true;
    }
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
  const error = await saveShipmentRow(existing.id, existing, "upsert");
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

  const error = await patchShipmentStatus(existing.id, existing);
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
  const heldMs = Date.parse(existing.heldAt || "");
  const pauseMs = Number.isFinite(heldMs) ? Math.max(0, Date.now() - heldMs) : 0;
  // Freeze accounted for: add hold duration so map/timeline resume from the stop point.
  setHoldPausedMs(existing, getHoldPausedMs(existing) + pauseMs);
  shiftPlanAfterHold(existing, pauseMs);
  existing.status = status;
  existing.deliveryStatus = deliveryStatus;
  existing.previousStatus = null;
  existing.holdReason = null;
  existing.statusReason = null;
  existing.heldAt = null;
  // No public timeline/reason on release — shipment simply resumes.
  // Strip any prior "HOLD RELEASED" scan so it never shows on tracking.
  existing.timeline = (existing.timeline || []).filter(function (ev) {
    return String((ev && ev.title) || "").toUpperCase() !== "HOLD RELEASED";
  });
  pushAdminEvent(existing, "release-hold", null);

  const error = await patchShipmentStatus(existing.id, existing);
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

  const error = await patchShipmentStatus(existing.id, existing);
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
  adminShipment,
  shipmentHasPackageImage,
  packageImagePayload
};

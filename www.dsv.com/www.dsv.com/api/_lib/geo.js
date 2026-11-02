const USER_AGENT = "DSV-Logistics-Control/1.0 (vercel admin)";

async function httpJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en"
    }
  });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  return res.json();
}

function addressPrimary(row, label) {
  const name = String(row.name || "").trim();
  if (name) return name;
  const addr = row.address || {};
  const house = String(addr.house_number || "").trim();
  const road = String(addr.road || addr.pedestrian || addr.residential || addr.path || "").trim();
  if (road) return house ? `${house} ${road}`.trim() : road;
  for (const key of [
    "neighbourhood",
    "suburb",
    "hamlet",
    "village",
    "town",
    "city",
    "municipality",
    "county",
    "state"
  ]) {
    const val = String(addr[key] || "").trim();
    if (val) return val;
  }
  return label.split(",")[0].trim();
}

async function searchAddresses(query, limit = 8) {
  // Worldwide Nominatim search — do not set countrycodes (all countries).
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    addressdetails: "1",
    limit: String(Math.max(1, Math.min(limit, 10))),
    "accept-language": "en"
  });
  const data = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const results = [];
  for (const row of data) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const label = String(row.display_name || "").trim();
    if (!label || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const primary = addressPrimary(row, label);
    let secondary = label;
    if (primary && label.toLowerCase().startsWith(String(primary).toLowerCase())) {
      secondary = label.slice(String(primary).length).replace(/^[\s,]+/, "") || label;
    }
    results.push({
      label,
      primary: String(primary),
      secondary,
      lat,
      lon,
      type: row.type || row.category || row.class || ""
    });
  }
  return results;
}

async function geocodeAddress(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const candidates = [q];
  const cleaned = q
    .replace(/\b(apt|apartment|unit|suite|ste|#)\s*[a-z0-9\-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^,+|,+$/g, "")
    .trim();
  if (cleaned && cleaned.toLowerCase() !== q.toLowerCase()) candidates.push(cleaned);
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) candidates.push(parts.slice(-2).join(", "));
  if (parts.length >= 3) candidates.push(parts.slice(-3).join(", "));

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    const hits = await searchAddresses(candidate, 1);
    if (hits && hits[0]) return hits[0];
    await new Promise((resolve) => setTimeout(resolve, 1050));
  }
  return null;
}

async function reverseLabel(lat, lon) {
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    format: "json",
    zoom: "12"
  });
  try {
    const data = await httpJson(`https://nominatim.openstreetmap.org/reverse?${params}`);
    const addr = data && data.address ? data.address : {};
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || "";
    const state = addr.state || addr.region || "";
    const country = addr.country_code || "";
    const parts = [city, state].filter(Boolean);
    if (parts.length) {
      let label = parts.join(", ");
      if (country) label += `, ${String(country).toUpperCase()}`;
      return label.toUpperCase();
    }
    if (data && data.display_name) {
      return data.display_name.split(",").slice(0, 3).map((s) => s.trim()).join(", ").toUpperCase();
    }
  } catch (err) {
    /* ignore */
  }
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

async function fetchRoute(fromLat, fromLon, toLat, toLon) {
  const coords = `${fromLon.toFixed(6)},${fromLat.toFixed(6)};${toLon.toFixed(6)},${toLat.toFixed(6)}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const data = await httpJson(url);
  const route = data && data.routes && data.routes[0];
  if (!route || !route.geometry || !route.geometry.coordinates || route.geometry.coordinates.length < 2) {
    return null;
  }
  return {
    distanceM: Number(route.distance || 0),
    durationS: Number(route.duration || 0),
    coordinates: route.geometry.coordinates
  };
}

function sampleRoutePoints(coordinates, count) {
  if (count <= 0 || coordinates.length < 2) return [];
  const n = coordinates.length;
  const seen = new Set();
  const points = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / (count + 1);
    const idx = Math.min(n - 2, Math.max(1, Math.round(t * (n - 1))));
    if (seen.has(idx)) continue;
    seen.add(idx);
    points.push([Number(coordinates[idx][1]), Number(coordinates[idx][0])]);
  }
  return points;
}

function formatStamp(dt) {
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const year = dt.getFullYear();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month}/${day}/${year} ${hours}:${minutes} ${ampm}`;
}

function formatEta(dt) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${days[dt.getDay()]}, ${month}/${day}/${dt.getFullYear()} by end of day`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildRoutePlan(fromLabel, toLabel, fromLat, fromLon, toLat, toLon, transitHours = 72) {
  let route = null;
  try {
    route = await fetchRoute(fromLat, fromLon, toLat, toLon);
  } catch (err) {
    route = null;
  }

  let coords = (route && route.coordinates) || [];
  let distanceM = route ? route.distanceM : 0;
  let durationS = route ? route.durationS : transitHours * 3600;

  if (!coords.length) {
    coords = [];
    for (let i = 0; i < 12; i += 1) {
      const t = i / 11;
      coords.push([fromLon + (toLon - fromLon) * t, fromLat + (toLat - fromLat) * t]);
    }
    distanceM = Math.hypot(
      (toLon - fromLon) * 111320 * Math.cos((fromLat * Math.PI) / 180),
      (toLat - fromLat) * 110540
    );
  }

  const midPoints = sampleRoutePoints(coords, 4);
  const stops = [{ lat: fromLat, lon: fromLon, label: fromLabel, kind: "origin" }];
  for (const [lat, lon] of midPoints) {
    await sleep(350);
    stops.push({ lat, lon, label: await reverseLabel(lat, lon), kind: "transit" });
  }
  stops.push({ lat: toLat, lon: toLon, label: toLabel, kind: "destination" });

  const now = new Date();
  const totalHours = Math.max(transitHours, (durationS / 3600) * 1.15);
  const eta = new Date(now.getTime() + totalHours * 3600 * 1000);

  const planned = [
    { title: "LABEL CREATED", location: `FROM ${fromLabel}`, fraction: 0, stopIndex: 0 },
    {
      title: "PACKAGE RECEIVED BY DSV",
      location: (stops[0].label.split(",")[0] || fromLabel).toUpperCase(),
      fraction: 0.06,
      stopIndex: 0
    }
  ];

  const transitStops = stops.map((s, i) => (s.kind === "transit" ? i : -1)).filter((i) => i >= 0);
  transitStops.forEach((stopI, idx) => {
    const frac = 0.15 + (0.65 * (idx + 1)) / Math.max(1, transitStops.length + 1);
    planned.push({
      title: "IN TRANSIT",
      location: stops[stopI].label,
      fraction: frac,
      stopIndex: stopI
    });
  });

  planned.push({ title: "OUT FOR DELIVERY", location: toLabel, fraction: 0.9, stopIndex: stops.length - 1 });
  planned.push({ title: "DELIVERED", location: toLabel, fraction: 1, stopIndex: stops.length - 1 });

  planned.forEach((event) => {
    const when = new Date(now.getTime() + totalHours * Number(event.fraction) * 3600 * 1000);
    event.date = formatStamp(when);
    event.at = when.toISOString();
  });

  let near = stops[0].label;
  if (near.includes(",")) {
    near = near.split(",").slice(0, 2).map((p) => p.trim()).filter(Boolean).join(", ");
  }

  return {
    distanceM,
    durationS,
    etaAt: eta.toISOString(),
    estimatedDelivery: formatEta(eta),
    routeStops: stops,
    plannedEvents: planned,
    statusNearPlace: near,
    labelCreatedDate: formatStamp(now).split(" ")[0],
    createdAt: now.toISOString()
  };
}

function timelineForStatus(plannedEvents, status) {
  // FedEx-style seed: only the latest scan that matches the starting status.
  // Later hubs appear over time via progressShipment — never dump the full plan up front.
  const s = String(status || "in-transit").toLowerCase();
  let stopTitle = "LABEL CREATED";
  if (s === "in-transit") stopTitle = "PACKAGE RECEIVED BY DSV";
  else if (s === "out-for-delivery") stopTitle = "OUT FOR DELIVERY";
  else if (s === "delivered") stopTitle = "DELIVERED";
  else if (s === "label-created" || s === "pending") stopTitle = "LABEL CREATED";

  const out = [];
  for (const ev of plannedEvents || []) {
    out.push({ title: ev.title, location: ev.location, date: ev.date });
    if (ev.title === stopTitle) break;
    // If pick-up isn't in the plan yet, stop after the first IN TRANSIT for in-transit seeds.
    if (stopTitle === "PACKAGE RECEIVED BY DSV" && ev.title === "IN TRANSIT") break;
  }
  if (!out.length && plannedEvents && plannedEvents[0]) {
    const ev = plannedEvents[0];
    out.push({ title: ev.title, location: ev.location, date: ev.date });
  }
  return out;
}

function statusMeta(status) {
  const s = String(status || "in-transit").toLowerCase();
  const map = {
    "label-created": ["label-created", "Label Created"],
    pending: ["pending", "Pending"],
    "in-transit": ["in-transit", "In Transit"],
    "out-for-delivery": ["out-for-delivery", "Out For Delivery"],
    delivered: ["delivered", "Delivered"],
    "on-hold": ["on-hold", "On Hold"],
    cancelled: ["cancelled", "Cancelled"],
    exception: ["exception", "Delayed / Exception"]
  };
  return map[s] || map["in-transit"];
}

module.exports = {
  searchAddresses,
  geocodeAddress,
  buildRoutePlan,
  timelineForStatus,
  statusMeta
};

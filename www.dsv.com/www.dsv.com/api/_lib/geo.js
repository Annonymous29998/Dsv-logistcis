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

function normalizeSearchQuery(query) {
  return String(query || "")
    .replace(/\bste\.?\b/gi, "suite")
    .replace(/\bapt\.?\b/gi, "apartment")
    .replace(/\brd\.?\b/gi, "road")
    .replace(/\bst\.?\b/gi, "street")
    .replace(/\bave\.?\b/gi, "avenue")
    .replace(/\bblvd\.?\b/gi, "boulevard")
    .replace(/\bdr\.?\b/gi, "drive")
    .replace(/\bln\.?\b/gi, "lane")
    .replace(/\bhwy\.?\b/gi, "highway")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function photonLabel(props) {
  props = props || {};
  const parts = [];
  const house = String(props.housenumber || "").trim();
  const street = String(props.street || props.name || "").trim();
  if (street) parts.push(house ? `${house} ${street}` : street);
  else if (props.name) parts.push(String(props.name).trim());
  for (const key of ["district", "city", "town", "village", "county", "state", "postcode", "country"]) {
    const val = String(props[key] || "").trim();
    if (val && !parts.some((p) => p.toLowerCase() === val.toLowerCase())) parts.push(val);
  }
  return parts.filter(Boolean).join(", ");
}

async function searchPhoton(query, limit) {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.max(1, Math.min(limit, 10))),
    lang: "en"
  });
  const data = await httpJson(`https://photon.komoot.io/api/?${params}`);
  const features = data && Array.isArray(data.features) ? data.features : [];
  const results = [];
  for (const feature of features) {
    const props = feature.properties || {};
    const coords = feature.geometry && feature.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const label = photonLabel(props);
    if (!label || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const primary =
      [props.housenumber, props.street || props.name].filter(Boolean).join(" ").trim() ||
      label.split(",")[0].trim();
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
      type: props.osm_value || props.type || props.osm_key || "place",
      source: "photon"
    });
  }
  return results;
}

async function searchNominatim(query, limit) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: String(Math.max(1, Math.min(limit, 10))),
    "accept-language": "en"
  });
  const data = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!Array.isArray(data)) return [];
  const results = [];
  for (const row of data) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const label = String(row.display_name || "").trim();
    if (!label || Number.isNaN(lat) || Number.isNaN(lon)) continue;
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
      type: row.type || row.category || row.class || "",
      source: "nominatim"
    });
  }
  return results;
}

function tokensOf(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && t.length > 1 && !["the", "and", "for", "usa", "united", "states"].includes(t));
}

const US_STATE_NAMES = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia"
};

function looksLikeUsQuery(query) {
  const q = String(query || "").toLowerCase();
  if (/\b(usa|u\.s\.a?|united states)\b/.test(q)) return true;
  return Object.keys(US_STATE_NAMES).some((code) => new RegExp(`\\b${code}\\b`, "i").test(q));
}

function scoreAddressMatch(label, query) {
  const qTokens = tokensOf(query);
  const lTokens = new Set(tokensOf(label));
  if (!qTokens.length) return 0;
  let hit = 0;
  for (const t of qTokens) {
    if (lTokens.has(t)) hit += 1;
    else if ([...lTokens].some((lt) => lt.startsWith(t) || t.startsWith(lt))) hit += 0.5;
  }
  // Prefer denser matches; slight boost when house number appears.
  const house = (String(query).match(/\b(\d+[a-z]?)\b/i) || [])[1];
  const labelLower = String(label).toLowerCase();
  if (house && labelLower.includes(String(house).toLowerCase())) hit += 1.5;

  // Prefer US results when the query looks American (stops Canada/elsewhere winning).
  if (looksLikeUsQuery(query)) {
    if (labelLower.includes("united states") || labelLower.includes("usa")) hit += 2.5;
    if (labelLower.includes("canada") || labelLower.includes("mexico")) hit -= 4;
    for (const [code, name] of Object.entries(US_STATE_NAMES)) {
      if (new RegExp(`\\b${code}\\b`, "i").test(query) && labelLower.includes(name)) {
        hit += 2;
        break;
      }
    }
  }
  return hit / Math.max(1, qTokens.length) + hit * 0.05;
}

function dedupeResults(rows, limit, query) {
  const seen = new Set();
  const ranked = (rows || []).slice().sort((a, b) => {
    const sa = scoreAddressMatch(a.label, query);
    const sb = scoreAddressMatch(b.label, query);
    if (sb !== sa) return sb - sa;
    const as = a.source === "photon" ? 0 : 1;
    const bs = b.source === "photon" ? 0 : 1;
    return as - bs;
  });
  const out = [];
  for (const row of ranked) {
    const key = String(row.label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const coarse = `${Number(row.lat).toFixed(4)},${Number(row.lon).toFixed(4)}`;
    if (!key || seen.has(key) || seen.has(coarse)) continue;
    seen.add(key);
    seen.add(coarse);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

async function searchNominatimStructured(query, limit) {
  // Parse "123 Main St, City, ST 12345" style queries for stronger matches.
  const cleaned = normalizeSearchQuery(query)
    .replace(/\b(apt|apartment|unit|suite|#)\s*[a-z0-9\-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return [];
  const street = parts[0];
  const city = parts[1] || "";
  const stateZip = parts[2] || parts[parts.length - 1] || "";
  const state = (stateZip.match(/\b[A-Za-z]{2}\b/) || [])[0] || stateZip.replace(/\d+/g, "").trim();
  const postalcode = (stateZip.match(/\b\d{5}(?:-\d{4})?\b/) || [])[0] || "";
  if (!street) return [];

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: String(Math.max(1, Math.min(limit, 10))),
    "accept-language": "en",
    street
  });
  if (city) params.set("city", city);
  if (state) params.set("state", state);
  if (postalcode) params.set("postalcode", postalcode);
  params.set("country", "United States");

  try {
    const data = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!Array.isArray(data) || !data.length) {
      // Retry street without house number so map can still place nearby.
      const noHouse = street.replace(/^\d+[a-z]?\s+/i, "").trim();
      if (!noHouse || noHouse === street) return [];
      params.set("street", noHouse);
      const data2 = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!Array.isArray(data2)) return [];
      return data2.map((row) => {
        const label = String(row.display_name || "").trim();
        return {
          label,
          primary: addressPrimary(row, label),
          secondary: label,
          lat: Number(row.lat),
          lon: Number(row.lon),
          type: row.type || "",
          source: "nominatim-structured"
        };
      }).filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon));
    }
    return data.map((row) => {
      const label = String(row.display_name || "").trim();
      return {
        label,
        primary: addressPrimary(row, label),
        secondary: label,
        lat: Number(row.lat),
        lon: Number(row.lon),
        type: row.type || "",
        source: "nominatim-structured"
      };
    }).filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon));
  } catch (_err) {
    return [];
  }
}

async function searchAddresses(query, limit = 8) {
  // Photon (autocomplete) + Nominatim free-text + structured — map more addresses reliably.
  const raw = String(query || "").trim();
  const q = normalizeSearchQuery(raw);
  if (q.length < 2) return [];
  const max = Math.max(1, Math.min(limit, 10));
  const usBias = looksLikeUsQuery(q) ? " USA" : "";
  const queries = Array.from(
    new Set(
      [
        q,
        raw,
        q.replace(/,/g, " ").replace(/\s{2,}/g, " ").trim(),
        q.replace(/\b(apt|apartment|unit|suite|#)\s*[a-z0-9\-]+\b/gi, " ").replace(/\s{2,}/g, " ").trim(),
        usBias ? `${q}${usBias}` : ""
      ].filter((s) => s && s.length >= 2)
    )
  );

  const collected = [];
  await Promise.all([
    ...queries.slice(0, 2).map(async (candidate) => {
      try {
        collected.push(...(await searchPhoton(candidate, max)));
      } catch (_err) {}
    }),
    (async () => {
      try {
        collected.push(...(await searchNominatim(queries[0], max)));
      } catch (_err) {}
    })(),
    (async () => {
      collected.push(...(await searchNominatimStructured(queries[0], max)));
    })()
  ]);

  return dedupeResults(collected, max, q);
}

async function geocodeAddress(query) {
  const q = normalizeSearchQuery(query);
  if (!q) return null;

  const candidates = [];
  const push = (value) => {
    const v = String(value || "").replace(/\s{2,}/g, " ").trim();
    if (!v) return;
    if (!candidates.some((c) => c.toLowerCase() === v.toLowerCase())) candidates.push(v);
  };

  push(q);
  push(
    q
      .replace(/\b(apt|apartment|unit|suite|ste|#)\s*[a-z0-9\-]+\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/^,+|,+$/g, "")
      .trim()
  );
  // Drop house number → street/city still maps (OSM often lacks exact suite/house).
  push(q.replace(/^\d+[a-z]?\s+/i, ""));
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    push(parts.slice(0, 2).join(", "));
    push(parts.slice(-2).join(", "));
  }
  if (parts.length >= 3) push(parts.slice(0, 3).join(", "));
  if (parts[0]) push(parts[0].replace(/^\d+[a-z]?\s+/i, "") + (parts[1] ? `, ${parts[1]}` : ""));

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const hits = await searchAddresses(candidate, 5);
    for (const hit of hits || []) {
      const score = scoreAddressMatch(hit.label, q);
      if (score > bestScore) {
        best = hit;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.55) return best;
  }
  return best;
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

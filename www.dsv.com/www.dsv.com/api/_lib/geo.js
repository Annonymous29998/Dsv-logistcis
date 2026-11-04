const USER_AGENT = "DSV-Logistics-Control/1.0 (vercel admin)";

function googleMapsKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ""
  ).trim();
}

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

function googlePrimary(result) {
  const comps = Array.isArray(result.address_components) ? result.address_components : [];
  const get = (type) => {
    const hit = comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
    return hit ? String(hit.long_name || hit.short_name || "").trim() : "";
  };
  const streetNum = get("street_number");
  const route = get("route");
  if (route) return streetNum ? `${streetNum} ${route}` : route;
  if (result.name) return String(result.name).trim();
  const label = String(result.formatted_address || "").trim();
  return label.split(",")[0].trim();
}

async function searchGooglePlaces(query, limit) {
  const key = googleMapsKey();
  if (!key) return [];
  const max = Math.max(1, Math.min(limit, 10));
  try {
    const autoParams = new URLSearchParams({
      input: query,
      key,
      language: "en"
      // no components/country filter — worldwide
    });
    const auto = await httpJson(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${autoParams}`
    );
    if (auto.status && auto.status !== "OK" && auto.status !== "ZERO_RESULTS") {
      return [];
    }
    const predictions = Array.isArray(auto.predictions) ? auto.predictions.slice(0, max) : [];
    if (!predictions.length) {
      // Fall through to Geocoding which often still finds exact addresses.
      return geocodeGoogleList(query, max);
    }

    const rows = await Promise.all(
      predictions.map(async (pred) => {
        try {
          const detailParams = new URLSearchParams({
            place_id: pred.place_id,
            fields: "geometry,formatted_address,name,address_component",
            key,
            language: "en"
          });
          const detail = await httpJson(
            `https://maps.googleapis.com/maps/api/place/details/json?${detailParams}`
          );
          const result = detail && detail.result ? detail.result : null;
          if (!result || !result.geometry || !result.geometry.location) return null;
          const lat = Number(result.geometry.location.lat);
          const lon = Number(result.geometry.location.lng);
          const label = String(result.formatted_address || pred.description || "").trim();
          if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          const primary = googlePrimary(result) || String(pred.structured_formatting?.main_text || "").trim();
          let secondary = label;
          if (primary && label.toLowerCase().startsWith(primary.toLowerCase())) {
            secondary = label.slice(primary.length).replace(/^[\s,]+/, "") || label;
          } else if (pred.structured_formatting?.secondary_text) {
            secondary = String(pred.structured_formatting.secondary_text);
          }
          return {
            label,
            primary: primary || label.split(",")[0],
            secondary,
            lat,
            lon,
            type: "google",
            source: "google"
          };
        } catch (_err) {
          return null;
        }
      })
    );
    return rows.filter(Boolean);
  } catch (_err) {
    return [];
  }
}

async function geocodeGoogleList(query, limit) {
  const key = googleMapsKey();
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      address: query,
      key,
      language: "en"
    });
    const data = await httpJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];
    const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];
    return results
      .map((result) => {
        const lat = Number(result.geometry && result.geometry.location && result.geometry.location.lat);
        const lon = Number(result.geometry && result.geometry.location && result.geometry.location.lng);
        const label = String(result.formatted_address || "").trim();
        if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const primary = googlePrimary(result);
        let secondary = label;
        if (primary && label.toLowerCase().startsWith(primary.toLowerCase())) {
          secondary = label.slice(primary.length).replace(/^[\s,]+/, "") || label;
        }
        return {
          label,
          primary: primary || label.split(",")[0],
          secondary,
          lat,
          lon,
          type: "google-geocode",
          source: "google"
        };
      })
      .filter(Boolean);
  } catch (_err) {
    return [];
  }
}

async function geocodeGoogle(query) {
  const rows = await geocodeGoogleList(query, 1);
  return rows[0] || null;
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
    // Canadian / apartment style "109-989 Range Rd" → keep street number 989
    .replace(/\b(\d+)\s*[-–]\s*(?=\d+)/g, "")
    .replace(/\bYT\b/g, "Yukon")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function looksLikeCanadaQuery(query) {
  const q = String(query || "").toLowerCase();
  if (/\bcanada\b/.test(q)) return true;
  if (/\b[a-z]\d[a-z]\s*\d[a-z]\d\b/i.test(String(query || ""))) return true; // postal e.g. Y1A 6K1
  return /\b(yukon|whitehorse|ontario|alberta|manitoba|saskatchewan|nunavut|northwest territories)\b/i.test(q);
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
  const q = String(query || "").toLowerCase().trim();
  if (/\b(usa|u\.s\.a?|united states)\b/.test(q)) return true;
  // Avoid treating words like "or"/"in"/"me" as US state codes worldwide.
  const trailingState = q.match(/,\s*([a-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/i);
  if (trailingState && US_STATE_NAMES[trailingState[1].toLowerCase()]) return true;
  const stateZip = q.match(/\b([a-z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
  if (stateZip && US_STATE_NAMES[stateZip[1].toLowerCase()]) return true;
  return false;
}

function scoreAddressMatch(label, query, primary) {
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

  // Strongly prefer results whose primary name matches the street/place typed first.
  const head = String(query || "").split(",")[0].trim().toLowerCase();
  const headTokens = tokensOf(head);
  const primaryText = String(primary || label.split(",")[0] || "").toLowerCase();
  const primaryTokens = new Set(tokensOf(primaryText));
  if (headTokens.length) {
    let headHit = 0;
    for (const t of headTokens) {
      if (primaryTokens.has(t) || primaryText.includes(t)) headHit += 1;
    }
    if (headHit === headTokens.length) hit += 3.5;
    else if (headHit > 0) hit += headHit * 0.75;
    if (primaryText && (primaryText.includes(head) || head.includes(primaryText))) hit += 2;
  }

  // Prefer US results only when the query itself looks American.
  if (looksLikeUsQuery(query) && !looksLikeCanadaQuery(query)) {
    if (labelLower.includes("united states") || labelLower.includes("usa")) hit += 2.5;
    if (labelLower.includes("canada") || labelLower.includes("mexico")) hit -= 4;
    for (const [code, name] of Object.entries(US_STATE_NAMES)) {
      if (new RegExp(`\\b${code}\\b`, "i").test(query) && labelLower.includes(name)) {
        hit += 2;
        break;
      }
    }
  }
  // Canada queries must not snap to US streets with similar names.
  if (looksLikeCanadaQuery(query)) {
    if (labelLower.includes("canada")) hit += 3.5;
    if (labelLower.includes("united states") || labelLower.includes("usa")) hit -= 8;
    if (/\byukon\b|\byt\b/i.test(String(query || "")) && labelLower.includes("yukon")) hit += 2;
    if (/\bwhitehorse\b/i.test(String(query || "")) && labelLower.includes("whitehorse")) hit += 2;
  }
  // Boost when the typed country name appears in the result (worldwide).
  const countryBoost = [
    "united kingdom", "canada", "nigeria", "ghana", "kenya", "australia",
    "germany", "france", "india", "brazil", "japan", "china", "mexico",
    "south africa", "uae", "singapore", "philippines", "pakistan"
  ];
  for (const c of countryBoost) {
    if (new RegExp(`\\b${c}\\b`, "i").test(String(query || "")) && labelLower.includes(c)) {
      hit += 2;
      break;
    }
  }
  return hit / Math.max(1, qTokens.length) + hit * 0.05;
}

function dedupeResults(rows, limit, query) {
  const seen = new Set();
  const ranked = (rows || []).slice().sort((a, b) => {
    const sa = scoreAddressMatch(a.label, query, a.primary);
    const sb = scoreAddressMatch(b.label, query, b.primary);
    if (sb !== sa) return sb - sa;
    const rank = (s) => (s === "google" ? 0 : s === "photon" ? 1 : 2);
    return rank(a.source) - rank(b.source);
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

function detectCountryHint(query, parts) {
  const q = String(query || "").toLowerCase();
  const last = String((parts && parts[parts.length - 1]) || "").trim();
  const lastLower = last.toLowerCase();

  // Explicit country name / code in the last comma segment or free text.
  const named = [
    ["united states", "United States"],
    ["usa", "United States"],
    ["u.s.a", "United States"],
    ["u.s.", "United States"],
    ["united kingdom", "United Kingdom"],
    ["uk", "United Kingdom"],
    ["great britain", "United Kingdom"],
    ["england", "United Kingdom"],
    ["canada", "Canada"],
    ["mexico", "Mexico"],
    ["nigeria", "Nigeria"],
    ["ghana", "Ghana"],
    ["kenya", "Kenya"],
    ["south africa", "South Africa"],
    ["australia", "Australia"],
    ["new zealand", "New Zealand"],
    ["germany", "Germany"],
    ["france", "France"],
    ["spain", "Spain"],
    ["italy", "Italy"],
    ["netherlands", "Netherlands"],
    ["belgium", "Belgium"],
    ["switzerland", "Switzerland"],
    ["sweden", "Sweden"],
    ["norway", "Norway"],
    ["denmark", "Denmark"],
    ["ireland", "Ireland"],
    ["portugal", "Portugal"],
    ["brazil", "Brazil"],
    ["argentina", "Argentina"],
    ["chile", "Chile"],
    ["colombia", "Colombia"],
    ["india", "India"],
    ["pakistan", "Pakistan"],
    ["bangladesh", "Bangladesh"],
    ["china", "China"],
    ["japan", "Japan"],
    ["south korea", "South Korea"],
    ["singapore", "Singapore"],
    ["malaysia", "Malaysia"],
    ["indonesia", "Indonesia"],
    ["philippines", "Philippines"],
    ["thailand", "Thailand"],
    ["vietnam", "Vietnam"],
    ["uae", "United Arab Emirates"],
    ["united arab emirates", "United Arab Emirates"],
    ["saudi arabia", "Saudi Arabia"],
    ["egypt", "Egypt"],
    ["turkey", "Turkey"],
    ["poland", "Poland"],
    ["romania", "Romania"],
    ["ukraine", "Ukraine"],
    ["russia", "Russia"]
  ];
  for (const [needle, country] of named) {
    if (lastLower === needle || new RegExp(`\\b${needle.replace(/\./g, "\\.")}\\b`, "i").test(q)) {
      return country;
    }
  }
  // US-style state/ZIP without an explicit other country → United States.
  if (looksLikeUsQuery(query) && !/\b(canada|mexico|uk|united kingdom)\b/i.test(q)) {
    return "United States";
  }
  return "";
}

function mapStructuredRows(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
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
    })
    .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

async function searchNominatimStructured(query, limit) {
  // Parse "street, city, region/postal, country" for stronger worldwide matches.
  const cleaned = normalizeSearchQuery(query)
    .replace(/\b(apt|apartment|unit|suite|#)\s*[a-z0-9\-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return [];
  const street = parts[0];
  if (!street) return [];

  const country = detectCountryHint(cleaned, parts);
  const mid = parts.slice(1).filter((p) => {
    if (!country) return true;
    return p.toLowerCase() !== country.toLowerCase() &&
      !(country === "United States" && /^(usa|u\.s\.a?|united states)$/i.test(p)) &&
      !(country === "United Kingdom" && /^(uk|u\.k\.|united kingdom|great britain|england)$/i.test(p));
  });
  const city = mid[0] || "";
  const regionZip = mid[1] || mid[mid.length - 1] || "";
  const state =
    (regionZip.match(/\b[A-Za-z]{2}\b/) || [])[0] ||
    regionZip.replace(/\b\d[\dA-Za-z\-]*\b/g, "").trim();
  const postalcode =
    (regionZip.match(/\b\d{5}(?:-\d{4})?\b/) || [])[0] ||
    (regionZip.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i) || [])[0] || // UK
    (regionZip.match(/\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i) || [])[0] || // CA
    "";

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
  // Only pin a country when the query clearly names one — never force USA globally.
  if (country) params.set("country", country);

  try {
    let data = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!Array.isArray(data) || !data.length) {
      const noHouse = street.replace(/^\d+[a-z]?\s+/i, "").trim();
      if (!noHouse || noHouse === street) return [];
      params.set("street", noHouse);
      data = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`);
    }
    return mapStructuredRows(data);
  } catch (_err) {
    return [];
  }
}

async function searchAddressesOsm(query, limit = 8) {
  // Worldwide Photon + Nominatim fallback when Google is unavailable.
  const raw = String(query || "").trim();
  const q = normalizeSearchQuery(raw);
  if (q.length < 2) return [];
  const max = Math.max(1, Math.min(limit, 10));
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
  const country = detectCountryHint(q, parts);
  const countryBias =
    country && !new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)
      ? ` ${country}`
      : country && looksLikeUsQuery(q) && !/\busa\b|\bunited states\b/i.test(q)
        ? " USA"
        : "";
  const queries = Array.from(
    new Set(
      [
        q,
        raw,
        q.replace(/,/g, " ").replace(/\s{2,}/g, " ").trim(),
        q.replace(/\b(apt|apartment|unit|suite|#)\s*[a-z0-9\-]+\b/gi, " ").replace(/\s{2,}/g, " ").trim(),
        countryBias ? `${q}${countryBias}` : ""
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

async function searchAddresses(query, limit = 8) {
  const raw = String(query || "").trim();
  const q = normalizeSearchQuery(raw);
  if (q.length < 2) return [];
  const max = Math.max(1, Math.min(limit, 10));

  // Google Places covers essentially all addresses worldwide when a key is set.
  if (googleMapsKey()) {
    const google = await searchGooglePlaces(q, max);
    if (google.length) return dedupeResults(google, max, q);
    const geo = await geocodeGoogleList(q, max);
    if (geo.length) return dedupeResults(geo, max, q);
  }

  return searchAddressesOsm(q, max);
}

async function geocodeAddress(query) {
  const q = normalizeSearchQuery(query);
  if (!q) return null;

  if (googleMapsKey()) {
    const google = await geocodeGoogle(q);
    if (google) return google;
  }

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
  // Canadian civic: "989 Range Road, Whitehorse, Yukon, Canada"
  if (looksLikeCanadaQuery(q)) {
    push(q.replace(/\bYT\b/gi, "Yukon"));
    if (parts[0] && parts[1]) push(`${parts[0]}, ${parts[1]}, Canada`);
  }

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const hits = await searchAddressesOsm(candidate, 5);
    for (const hit of hits || []) {
      const score = scoreAddressMatch(hit.label, q, hit.primary);
      if (score > bestScore) {
        best = hit;
        bestScore = score;
      }
    }
    // Good enough on the first/full query — avoid hammering OSM for every rewrite.
    if (best && bestScore >= 0.55) break;
  }
  if (!best) return null;
  // Never accept a wrong-country snap (e.g. Canada query → USA street).
  if (looksLikeCanadaQuery(q) && !/canada/i.test(best.label)) return null;
  if (looksLikeUsQuery(q) && !looksLikeCanadaQuery(q) && /canada/i.test(best.label) && bestScore < 1) {
    return null;
  }
  if (bestScore < 0.25) return null;
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

/**
 * Single catch-all API for Vercel Hobby (max 12 serverless functions).
 * Routes /api/* through one function so the project stays under the limit.
 */
const fs = require("fs");
const path = require("path");
const { readJson, sendJson, parseCookies } = require("./_lib/http");
const {
  COOKIE_NAME,
  verifySessionToken,
  requireAdmin,
  authenticateAdmin,
  createSessionToken,
  writeSessionCookie,
  clearSessionCookie
} = require("./_lib/auth");
const {
  listShipments,
  getShipment,
  createShipment,
  clearAllShipments,
  updateShipment,
  holdShipment,
  releaseHold,
  cancelShipment,
  deleteShipment,
  previewRoute,
  publicShipment,
  adminShipment,
  packageImagePayload,
  shipmentHasPackageImage
} = require("./_lib/shipments");
const { searchAddresses } = require("./_lib/geo");
const {
  listChats,
  getChat,
  appendMessage,
  markCustomerRead,
  markAdminRead,
  markAgentConnected,
  setTyping,
  endChat,
  clearAllChats,
  patchChatMeta,
  emptyChat,
  normalizeChat
} = require("./_lib/support");
const { notifyChatWidgetStarted } = require("./_lib/telegram");

function pathParts(req) {
  // vercel.json rewrites /api/:path* -> /api?path=:path* because nested
  // filesystem catch-alls are unreliable on non-Next Vercel projects.
  const q = req.query && req.query.path;
  if (Array.isArray(q)) return q.join("/").split("/").filter(Boolean);
  if (typeof q === "string" && q.trim()) {
    return decodeURIComponent(q).split("/").filter(Boolean);
  }
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const fromQuery = url.searchParams.get("path");
    if (fromQuery) return decodeURIComponent(fromQuery).split("/").filter(Boolean);
    return url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  } catch (err) {
    return [];
  }
}

function shipmentListRow(item) {
  const timeline = item.timeline || [];
  const last = timeline[timeline.length - 1] || {};
  let deliveryNotice = item.deliveryNotice;
  if (deliveryNotice && typeof deliveryNotice === "object") {
    deliveryNotice = Object.assign({}, deliveryNotice);
    delete deliveryNotice.packageImage;
    if (!Object.keys(deliveryNotice).length) deliveryNotice = null;
  }
  return {
    id: item.id,
    status: item.status,
    deliveryStatus: item.deliveryStatus,
    serviceType: item.serviceType,
    sender: item.sender,
    receiver: item.receiver,
    fromLocation: item.fromLocation,
    toLocation: item.toLocation,
    statusNearPlace: item.statusNearPlace,
    packageContent: item.packageContent,
    hasPackageImage: shipmentHasPackageImage(item),
    signatureRequired: !!item.signatureRequired,
    estimatedDelivery: item.estimatedDelivery,
    deliveryTime: item.deliveryTime,
    labelCreatedDate: item.labelCreatedDate,
    deliveryNotice,
    holdReason: item.holdReason || null,
    cancelReason: item.cancelReason || null,
    statusReason: item.statusReason || null,
    previousStatus: item.previousStatus || null,
    heldAt: item.heldAt || null,
    cancelledAt: item.cancelledAt || null,
    holdPausedMs: Number(item.holdPausedMs || 0) || 0,
    timeline,
    routeStops: item.routeStops || [],
    fromLat: item.fromLat,
    fromLon: item.fromLon,
    toLat: item.toLat,
    toLon: item.toLon,
    routeDistanceM: item.routeDistanceM,
    routeDurationS: item.routeDurationS,
    createdAt: item.createdAt || null,
    etaAt: item.etaAt || null,
    lastEvent: last.title,
    lastDate: last.date,
    lastLocation: last.location
  };
}

async function handlePublicConfig(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  const geoapifyApiKey = String(process.env.GEOAPIFY_API_KEY || process.env.GEOAPIFY_KEY || "").trim();
  const realtime = !!(supabaseUrl && supabaseAnonKey);
  return sendJson(res, 200, {
    ok: true,
    realtime,
    supabaseUrl: realtime ? supabaseUrl : null,
    supabaseAnonKey: realtime ? supabaseAnonKey : null,
    // Same Geoapify key used for address search — also powers map tile fallback.
    geoapifyApiKey: geoapifyApiKey || null
  });
}

function headerValue(req, name) {
  const raw = (req.headers && (req.headers[name] || req.headers[String(name).toLowerCase()])) || "";
  return String(Array.isArray(raw) ? raw[0] : raw).trim();
}

function decodeHeader(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch (err) {
    return value;
  }
}

function clientIp(req) {
  const forwarded = headerValue(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    headerValue(req, "x-real-ip") ||
    headerValue(req, "cf-connecting-ip") ||
    headerValue(req, "x-vercel-forwarded-for") ||
    ""
  );
}

function countryNameFromCode(code) {
  const map = {
    US: "United States",
    GB: "United Kingdom",
    CA: "Canada",
    AU: "Australia",
    DE: "Germany",
    FR: "France",
    NL: "Netherlands",
    BE: "Belgium",
    DK: "Denmark",
    SE: "Sweden",
    NO: "Norway",
    FI: "Finland",
    IE: "Ireland",
    ES: "Spain",
    IT: "Italy",
    PT: "Portugal",
    PL: "Poland",
    NG: "Nigeria",
    GH: "Ghana",
    ZA: "South Africa",
    KE: "Kenya",
    IN: "India",
    PK: "Pakistan",
    BD: "Bangladesh",
    CN: "China",
    JP: "Japan",
    KR: "South Korea",
    BR: "Brazil",
    MX: "Mexico",
    AE: "United Arab Emirates",
    SA: "Saudi Arabia",
    SG: "Singapore",
    MY: "Malaysia",
    PH: "Philippines",
    NZ: "New Zealand"
  };
  const key = String(code || "").toUpperCase();
  return map[key] || key;
}

async function handleClientInfo(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const ip = clientIp(req);
  const city = decodeHeader(headerValue(req, "x-vercel-ip-city"));
  const region = decodeHeader(headerValue(req, "x-vercel-ip-country-region"));
  const countryCode = String(headerValue(req, "x-vercel-ip-country") || "").toUpperCase();
  const country = countryNameFromCode(countryCode);
  const label = [city, region && region !== city ? region : "", country].filter(Boolean).join(", ");
  return sendJson(res, 200, {
    ok: true,
    ip: ip || "",
    city: city || "",
    country: country || "",
    countryCode: countryCode || "",
    label: label || countryCode || ""
  });
}

async function handleAdminGuard(req, res) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) {
    res.statusCode = 302;
    res.setHeader("Location", "/admin/login");
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }
  try {
    const file = path.join(process.cwd(), "admin", "app.html");
    const html = fs.readFileSync(file, "utf8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(html);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: "Admin app unavailable." });
  }
}

async function handleAdminLogin(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(req);
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const remember = !!payload.remember;
  if (!email || !email.includes("@") || !password) {
    return sendJson(res, 400, { ok: false, error: "Enter a valid email and password." });
  }
  const admin = await authenticateAdmin(email, password);
  if (!admin) {
    return sendJson(res, 401, { ok: false, error: "Invalid administrator credentials." });
  }
  const token = createSessionToken(admin.email);
  writeSessionCookie(res, token, remember);
  return sendJson(res, 200, {
    ok: true,
    user: { email: admin.email, role: admin.role || "administrator" },
    redirect: "/admin/app"
  });
}

async function handleAdminLogout(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  clearSessionCookie(res);
  return sendJson(res, 200, { ok: true });
}

async function handleAdminMe(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) return sendJson(res, 401, { ok: false, authenticated: false });
  return sendJson(res, 200, {
    ok: true,
    authenticated: true,
    user: { email: session.email, role: session.role }
  });
}

async function handleAdminSummary(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireAdmin(req, res);
  if (!session) return;
  const shipments = await listShipments();
  const counts = {
    total: 0,
    inTransit: 0,
    outForDelivery: 0,
    delivered: 0,
    pending: 0,
    exception: 0,
    onHold: 0,
    cancelled: 0,
    active: 0
  };
  shipments.forEach((item) => {
    counts.total += 1;
    const status = String(item.status || "").toLowerCase();
    if (status === "delivered") counts.delivered += 1;
    else if (status === "out-for-delivery") counts.outForDelivery += 1;
    else if (status === "in-transit") counts.inTransit += 1;
    else if (status === "on-hold") {
      counts.onHold += 1;
      counts.exception += 1;
      counts.pending += 1;
    } else if (status === "cancelled") counts.cancelled += 1;
    else if (status === "exception") {
      counts.exception += 1;
      counts.pending += 1;
    } else if (status === "pending" || status === "label-created") counts.pending += 1;
    else counts.pending += 1;
  });
  counts.active = counts.inTransit + counts.outForDelivery;
  return sendJson(res, 200, { ok: true, summary: counts });
}

async function handleAdminShipmentsCollection(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (req.method === "DELETE") {
    const result = await clearAllShipments();
    return sendJson(res, 200, { ok: true, ...result });
  }
  if (req.method === "GET") {
    const shipments = await listShipments();
    const rows = shipments.map(shipmentListRow);
    return sendJson(res, 200, { ok: true, shipments: rows, count: rows.length });
  }
  if (req.method === "POST") {
    const payload = await readJson(req);
    const created = await createShipment(payload);
    return sendJson(res, 201, { ok: true, ...created });
  }
  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

async function handleAdminShipmentItem(req, res, id) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!id) return sendJson(res, 400, { ok: false, error: "Missing shipment id" });

  if (req.method === "GET") {
    const item = await getShipment(String(id));
    if (!item) return sendJson(res, 404, { ok: false, error: "Shipment not found." });
    return sendJson(res, 200, { ok: true, id: item.id, shipment: adminShipment(item) });
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    const payload = await readJson(req);
    const action = String(payload.action || "edit").toLowerCase();
    if (action === "hold") {
      const result = await holdShipment(String(id), payload.reason);
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (action === "release-hold" || action === "release") {
      const result = await releaseHold(String(id), payload.reason || payload.note);
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (action === "cancel") {
      const result = await cancelShipment(String(id), payload.reason);
      return sendJson(res, 200, { ok: true, ...result });
    }
    const result = await updateShipment(String(id), payload);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === "DELETE") {
    const result = await deleteShipment(String(id));
    return sendJson(res, 200, { ok: true, ...result });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

async function handlePreviewRoute(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireAdmin(req, res);
  if (!session) return;
  const payload = await readJson(req);
  const preview = await previewRoute(payload);
  return sendJson(res, 200, { ok: true, preview });
}

async function handleGeoSearch(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireAdmin(req, res);
  if (!session) return;
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams.get("q") || "";
  const results = await searchAddresses(q);
  return sendJson(res, 200, { ok: true, results });
}

async function handleAdminSupport(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === "GET") {
    const chats = await listChats();
    return sendJson(res, 200, { ok: true, chats });
  }
  if (req.method === "DELETE") {
    await clearAllChats();
    return sendJson(res, 200, { ok: true, chats: [] });
  }
  if (req.method === "POST") {
    const payload = await readJson(req);
    const action = String(payload.action || "message");
    if (action === "clear-all") {
      await clearAllChats();
      return sendJson(res, 200, { ok: true, chats: [] });
    }
    const id = String(payload.id || "").trim();
    if (!id) return sendJson(res, 400, { ok: false, error: "Missing chat id" });
    if (action === "read") {
      const chat = await markAdminRead(id);
      return sendJson(res, 200, { ok: true, chat });
    }
    if (action === "open") {
      const chat = await markAgentConnected(id);
      return sendJson(res, 200, { ok: true, chat });
    }
    if (action === "typing") {
      const chat = await setTyping(id, payload.typing !== false);
      return sendJson(res, 200, { ok: true, chat });
    }
    if (action === "end") {
      const chat = await endChat(id);
      return sendJson(res, 200, { ok: true, chat });
    }
    const text = String(payload.text || "").trim();
    if (!text) return sendJson(res, 400, { ok: false, error: "Message required" });
    const chat = await appendMessage(id, { from: "agent", text, at: Date.now() });
    return sendJson(res, 200, { ok: true, chat });
  }
  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

async function handleTracking(req, res, id) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  if (!id) return sendJson(res, 400, { ok: false, error: "Missing tracking id" });
  const item = await getShipment(String(id));
  if (!item) return sendJson(res, 404, { ok: false, error: "Tracking not found." });
  return sendJson(res, 200, { ok: true, id: item.id, shipment: publicShipment(item) });
}

async function handleTrackingPackageImage(req, res, id) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  if (!id) return sendJson(res, 400, { ok: false, error: "Missing tracking id" });
  const item = await getShipment(String(id));
  if (!item) return sendJson(res, 404, { ok: false, error: "Tracking not found." });
  const packageImage = packageImagePayload(item);
  if (!packageImage) return sendJson(res, 404, { ok: false, error: "No package image." });
  return sendJson(res, 200, { ok: true, id: item.id, packageImage });
}

async function handlePublicSupport(req, res, id) {
  if (!id) return sendJson(res, 400, { ok: false, error: "Missing chat id" });
  if (req.method === "GET") {
    const chat = await getChat(id);
    return sendJson(res, 200, { ok: true, chat: chat || normalizeChat(emptyChat(id)) });
  }
  if (req.method === "POST") {
    const payload = await readJson(req);
    const action = String(payload.action || "message");
    if (action === "read") {
      const chat = await markCustomerRead(id);
      return sendJson(res, 200, { ok: true, chat: chat || normalizeChat(emptyChat(id)) });
    }
    if (action === "meta") {
      const chat = await patchChatMeta(id, {
        name: payload.name,
        ip: payload.ip || clientIp(req) || "",
        city: payload.city || decodeHeader(headerValue(req, "x-vercel-ip-city")) || "",
        country:
          payload.country ||
          countryNameFromCode(headerValue(req, "x-vercel-ip-country")) ||
          "",
        countryCode:
          payload.countryCode || String(headerValue(req, "x-vercel-ip-country") || "").toUpperCase(),
        geoLabel: payload.geoLabel,
        awaitingAgent: payload.awaitingAgent,
        lastSeenAt: payload.lastSeenAt != null ? Number(payload.lastSeenAt) || Date.now() : Date.now(),
        browsing: payload.browsing !== false
      });
      return sendJson(res, 200, { ok: true, chat });
    }
    const text = String(payload.text || "").trim();
    if (!text) return sendJson(res, 400, { ok: false, error: "Message required" });
    const from = payload.from === "bot" ? "bot" : payload.from === "system" ? "system" : "customer";

    const existing = await getChat(id);
    const priorCustomerCount = ((existing && existing.messages) || []).filter(function (m) {
      return m && m.from === "customer";
    }).length;

    const geo = {
      ip: payload.ip || clientIp(req) || "",
      city: payload.city || decodeHeader(headerValue(req, "x-vercel-ip-city")) || "",
      country:
        payload.country ||
        countryNameFromCode(headerValue(req, "x-vercel-ip-country")) ||
        "",
      countryCode:
        payload.countryCode || String(headerValue(req, "x-vercel-ip-country") || "").toUpperCase(),
      geoLabel: payload.geoLabel || ""
    };
    if (!geo.geoLabel) {
      geo.geoLabel = [geo.city, geo.country].filter(Boolean).join(", ");
    }

    const chat = await appendMessage(
      id,
      { from, text, at: Date.now() },
      {
        name: payload.name,
        awaitingAgent: from === "customer" ? payload.awaitingAgent !== false : false,
        geo
      }
    );

    if (from === "customer" && priorCustomerCount === 0) {
      notifyChatWidgetStarted({
        name: (chat && chat.name) || payload.name || "Visitor",
        ip: (chat && chat.ip) || geo.ip,
        city: (chat && chat.city) || geo.city,
        country: (chat && chat.country) || geo.country,
        message: text
      });
    }

    return sendJson(res, 200, { ok: true, chat });
  }
  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

module.exports = async function handler(req, res) {
  const parts = pathParts(req);
  const key = parts.join("/");

  try {
    if (key === "public/config") return await handlePublicConfig(req, res);
    if (key === "client-info") return await handleClientInfo(req, res);
    if (key === "admin/guard") return await handleAdminGuard(req, res);
    if (key === "admin/login") return await handleAdminLogin(req, res);
    if (key === "admin/logout") return await handleAdminLogout(req, res);
    if (key === "admin/me") return await handleAdminMe(req, res);
    if (key === "admin/summary") return await handleAdminSummary(req, res);
    if (key === "admin/support") return await handleAdminSupport(req, res);
    if (key === "admin/geo/search") return await handleGeoSearch(req, res);
    if (key === "admin/shipments/preview-route") return await handlePreviewRoute(req, res);
    if (key === "admin/shipments") return await handleAdminShipmentsCollection(req, res);
    if (parts[0] === "admin" && parts[1] === "shipments" && parts[2]) {
      return await handleAdminShipmentItem(req, res, decodeURIComponent(parts[2]));
    }
    if (parts[0] === "tracking" && parts[1] && parts[2] === "package-image") {
      return await handleTrackingPackageImage(req, res, decodeURIComponent(parts[1]));
    }
    if (parts[0] === "tracking" && parts[1]) {
      return await handleTracking(req, res, decodeURIComponent(parts[1]));
    }
    if (parts[0] === "support" && parts[1]) {
      return await handlePublicSupport(req, res, decodeURIComponent(parts[1]));
    }
    return sendJson(res, 404, { ok: false, error: "API route not found." });
  } catch (err) {
    return sendJson(res, err.status || 500, {
      ok: false,
      error: err.message || "Request failed"
    });
  }
};

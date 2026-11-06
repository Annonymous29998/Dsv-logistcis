(function (global) {
  var DETAILS_PATH = "/new/tracking/shipment-details-public";
  var US_STATE_TZ = {
    AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
    CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DC: "America/New_York",
    DE: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
    IA: "America/Chicago", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
    KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", MA: "America/New_York",
    MD: "America/New_York", ME: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
    MO: "America/Chicago", MS: "America/Chicago", MT: "America/Denver", NC: "America/New_York",
    ND: "America/Chicago", NE: "America/Chicago", NH: "America/New_York", NJ: "America/New_York",
    NM: "America/Denver", NV: "America/Los_Angeles", NY: "America/New_York", OH: "America/New_York",
    OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
    SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
    UT: "America/Denver", VA: "America/New_York", VT: "America/New_York", WA: "America/Los_Angeles",
    WI: "America/Chicago", WV: "America/New_York", WY: "America/Denver"
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sanitizeTrackingToken(value) {
    return String(value).replace(/[^\dA-Za-z]/g, "").slice(0, 30);
  }

  function parseFirstTrackingNumber(raw) {
    var lines = String(raw || "")
      .split(/\r?\n/)
      .map(function (s) { return sanitizeTrackingToken(s.trim()); })
      .filter(Boolean);
    if (lines.length) return sanitizeTrackingToken(lines[0].split(",")[0].trim());
    return "";
  }

  function normalizeId(value) {
    return parseFirstTrackingNumber(value).toUpperCase();
  }

  function findShipmentLocal(id) {
    // Memory cache only (filled from /api/tracking).
    window.DSV_SHIPMENTS = window.DSV_SHIPMENTS || {};
    var map = window.DSV_SHIPMENTS;
    if (map[id]) return map[id];
    var upper = String(id || "").toUpperCase();
    if (map[upper]) return map[upper];
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).toUpperCase() === upper) return map[keys[i]];
    }
    return null;
  }

  function findShipment(id) {
    return findShipmentLocal(id);
  }

  function findShipmentAsync(id) {
    return fetch("/api/tracking/" + encodeURIComponent(id), {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !data.shipment) return null;
        window.DSV_SHIPMENTS = window.DSV_SHIPMENTS || {};
        window.DSV_SHIPMENTS[data.id || id] = data.shipment;
        return data.shipment;
      })
      .catch(function () {
        return null;
      });
  }

  function ensureRealtimeScript() {
    if (global.DsvRealtime) return Promise.resolve(global.DsvRealtime);
    return new Promise(function (resolve) {
      var existing = document.querySelector('script[src*="/resource/js/realtime.js"]');
      if (existing) {
        existing.addEventListener("load", function () { resolve(global.DsvRealtime || null); });
        existing.addEventListener("error", function () { resolve(null); });
        return;
      }
      var s = document.createElement("script");
      s.src = "/resource/js/realtime.js?v=20261102i";
      s.async = true;
      s.onload = function () { resolve(global.DsvRealtime || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
  }

  function isDetailsPage() {
    return !!document.getElementById("track-result") &&
      /shipment-details-public/i.test(window.location.pathname);
  }

  function detailsUrl(id) {
    return DETAILS_PATH + "?id=" + encodeURIComponent(id);
  }

  function goToDetails(id) {
    window.location.href = detailsUrl(id);
  }

  function parseUsCityStateFromLocation(loc) {
    var s = String(loc || "")
      .replace(/^FROM\s+/i, "")
      .trim()
      .replace(/,\s*USA\s*$/i, "");
    var m = s.match(/,\s*([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}))?\s*$/i);
    if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
    var m2 = s.match(/^([A-Za-z0-9 .'\-]+),\s*([A-Z]{2})(?:\s+(\d{5}))?\s*$/i);
    if (m2) return { city: m2[1].trim(), state: m2[2].toUpperCase() };
    return null;
  }

  function formatStatusNearFromLocation(loc) {
    var cleaned = String(loc || "")
      .replace(/^FROM\s+/i, "")
      .replace(/,\s*USA$/i, "")
      .replace(/,\s*SOUTH AFRICA$/i, "")
      .replace(/,\s*AUSTRALIA$/i, "")
      .trim();
    var parsed = parseUsCityStateFromLocation(cleaned);
    if (parsed) return parsed.city + ", " + parsed.state;
    if (/CAPE TOWN/i.test(cleaned)) return "Cape Town, South Africa";
    if (/JOHANNESBURG/i.test(cleaned)) return "Johannesburg, South Africa";
    if (/MELBOURNE|NIDDRIE|COGHLAN/i.test(cleaned)) return "Melbourne, Australia";
    if (/LAUREL/i.test(cleaned)) return "Laurel, MD";
    if (/HYATTSVILLE/i.test(cleaned)) return "Hyattsville, MD";
    if (/LANDOVER|ARDWICK/i.test(cleaned)) return "Landover, MD";
    if (/WASHINGTON/i.test(cleaned)) return "Washington, DC";
    return cleaned;
  }

  function shortPlace(loc) {
    return formatStatusNearFromLocation(loc) || String(loc || "").replace(/^FROM\s+/i, "").trim();
  }

  function resolveIanaTimeZone(locationString) {
    var u = String(locationString || "").toUpperCase();
    if (/CAPE TOWN|JOHANNESBURG|SOUTH AFRICA|IHLATHI|MANNINGFORD/.test(u)) return "Africa/Johannesburg";
    if (/MELBOURNE|NIDDRIE|COGHLAN|\bVIC\b/.test(u)) return "Australia/Melbourne";
    if (/SYDNEY|\bNSW\b|AUSTRALIA/.test(u)) return "Australia/Sydney";
    if (/LAGOS|NIGERIA/.test(u)) return "Africa/Lagos";
    if (/ACCRA|GHANA/.test(u)) return "Africa/Accra";
    if (/AMSTERDAM|NETHERLANDS/.test(u)) return "Europe/Amsterdam";
    if (/LONDON|MANCHESTER|UNITED KINGDOM|\bUK\b/.test(u)) return "Europe/London";
    if (/SHENZHEN|YANTIAN|CHINA/.test(u)) return "Asia/Shanghai";
    if (/TEMA/.test(u)) return "Africa/Accra";
    var parsed = parseUsCityStateFromLocation(locationString);
    if (!parsed) return null;
    return US_STATE_TZ[parsed.state] || null;
  }

  function parseUsDateTimeInZone(dateStr, timeZone) {
    var m = String(dateStr || "")
      .trim()
      .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
    if (!m) return null;
    var year = Number(m[3]);
    var month = Number(m[1]);
    var day = Number(m[2]);
    var hour = 0;
    var minute = 0;
    if (m[4]) {
      hour = Number(m[4]);
      minute = Number(m[5]);
      var ap = String(m[6]).toUpperCase();
      if (ap === "AM") {
        if (hour === 12) hour = 0;
      } else if (hour !== 12) {
        hour += 12;
      }
    }
    var tz = timeZone || "UTC";
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    function zoneParts(d) {
      var map = {};
      fmt.formatToParts(d).forEach(function (p) {
        if (p.type !== "literal") map[p.type] = p.value;
      });
      return map;
    }
    var utc = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (var i = 0; i < 4; i++) {
      var p = zoneParts(new Date(utc));
      var shownHour = Number(p.hour);
      if (shownHour === 24) shownHour = 0;
      var asWanted = Date.UTC(year, month - 1, day, hour, minute, 0);
      var asShown = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        shownHour,
        Number(p.minute),
        Number(p.second || 0)
      );
      utc += asWanted - asShown;
    }
    return new Date(utc);
  }

  function formatDateInZone(d, timeZone) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone,
        month: "2-digit",
        day: "2-digit",
        year: "numeric"
      }).formatToParts(d);
      var map = {};
      parts.forEach(function (p) {
        if (p.type !== "literal") map[p.type] = p.value;
      });
      return map.month + "/" + map.day + "/" + map.year;
    } catch (e) {
      return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    }
  }

  function formatDsvDate(dateStr) {
    var m = String(dateStr || "")
      .trim()
      .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
    if (!m) return String(dateStr || "");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var month = months[Number(m[1]) - 1] || m[1];
    var day = String(Number(m[2])).padStart(2, "0");
    var year = m[3];
    if (!m[4]) return day + "-" + month + "-" + year;
    var hour = Number(m[4]);
    var minute = m[5];
    var ap = String(m[6]).toUpperCase();
    if (ap === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return day + "-" + month + "-" + year + " " + String(hour).padStart(2, "0") + ":" + minute;
  }

  function locationMatchToken(loc) {
    var u = String(loc || "").toUpperCase();
    if (u.indexOf("TAMPA") >= 0 || u.indexOf("KNOLLWOOD") >= 0) return "TAMPA";
    if (u.indexOf("ORLANDO") >= 0 || u.indexOf("DIRECTORS ROW") >= 0) return "ORLANDO";
    if (u.indexOf("JACKSONVILLE") >= 0 || u.indexOf("PRITCHARD") >= 0) return "JACKSONVILLE";
    if (u.indexOf("LUTZ") >= 0) return "LUTZ";
    if (u.indexOf("CLEARWATER") >= 0) return "CLEARWATER";
    if (u.indexOf("MEMPHIS") >= 0) return "MEMPHIS";
    if (u.indexOf("LANDOVER") >= 0 || u.indexOf("ARDWICK") >= 0) return "LANDOVER";
    return u.split(",")[0].trim();
  }

  function deliveryStatusFromScanTitle(title) {
    if (title === "DELIVERED" || title === "TO") return "Delivered";
    if (title === "OUT FOR DELIVERY") return "Out For Delivery";
    if (title === "DELIVERY EXCEPTION") return "Delivery Exception";
    if (title === "FROM" || title === "LABEL CREATED") return "Label Created";
    return "In Transit";
  }

  function milestoneLabel(title) {
    var t = String(title || "").toUpperCase();
    if (t === "LABEL CREATED" || t === "FROM") return "BOOKED";
    if (t === "PACKAGE RECEIVED BY DSV") return "PICK-UP";
    if (t === "OUT FOR DELIVERY") return "OUT FOR DELIVERY";
    if (t === "DELIVERED" || t === "TO") return "DELIVERED";
    if (t === "DELIVERY EXCEPTION") return "EXCEPTION";
    if (t === "ON HOLD" || t.indexOf("HOLD") === 0) return "ON HOLD";
    if (t === "CANCELLED" || t.indexOf("CANCEL") === 0) return "CANCELLED";
    if (t === "IN TRANSIT") return "IN TRANSIT";
    return t || "UPDATE";
  }

  function statusAlertHtml(data) {
    var status = String(data.status || "").toLowerCase();
    var delivery = String(data.deliveryStatus || "").trim();
    var holdReason = String(data.holdReason || data.statusReason || "").trim();
    var cancelReason = String(data.cancelReason || data.statusReason || "").trim();
    var notice = "";
    if (data.deliveryNotice && typeof data.deliveryNotice === "object") {
      notice = String(data.deliveryNotice.en || data.deliveryNotice.text || "").trim();
    } else {
      notice = String(data.deliveryNotice || "").trim();
    }

    if (status === "on-hold") {
      return (
        '<div class="mydsv-alert mydsv-alert--hold" role="status">' +
          "<strong>On hold</strong>" +
          "<p>Reasons: " + escapeHtml(holdReason || "This shipment is temporarily on hold.") + "</p>" +
        "</div>"
      );
    }
    if (status === "cancelled") {
      return (
        '<div class="mydsv-alert mydsv-alert--cancel" role="status">' +
          "<strong>Cancelled</strong>" +
          "<p>Reasons: " + escapeHtml(cancelReason || "This shipment was cancelled.") + "</p>" +
        "</div>"
      );
    }
    if (status === "exception") {
      return (
        '<div class="mydsv-alert mydsv-alert--hold" role="status">' +
          "<strong>Exception</strong>" +
          "<p>Reasons: " + escapeHtml(holdReason || notice || "There is an exception on this shipment.") + "</p>" +
        "</div>"
      );
    }
    if (status === "in-transit" || status === "out-for-delivery" || status === "delivered" || status === "pending") {
      return (
        '<div class="mydsv-alert mydsv-alert--ok" role="status">' +
          "<strong>" + escapeHtml(delivery || titleCase(status.replace(/-/g, " "))) + "</strong>" +
          (notice ? "<p>" + escapeHtml(notice) + "</p>" : "") +
        "</div>"
      );
    }
    return "";
  }

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  function modeKind(serviceType) {
    var s = String(serviceType || "").toUpperCase();
    if (s.indexOf("AIR") >= 0) return "air";
    if (s.indexOf("SEA") >= 0 || s.indexOf("OCEAN") >= 0) return "sea";
    return "road";
  }

  function modeIcon(kind) {
    if (kind === "air") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';
    }
    if (kind === "sea") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17c1.5 1.2 3.2 1.8 5 1.8s3.5-.6 5-1.8c1.5 1.2 3.2 1.8 5 1.8.7 0 1.3-.1 2-.2V19c-.7.2-1.4.3-2.1.3-1.8 0-3.5-.6-5-1.8-1.5 1.2-3.2 1.8-5 1.8S4.5 18.4 3 17zm16.7-6.3L12 3 4.3 10.7c-.4.4-.3 1 .2 1.3L11 16v-5h2v5l6.5-4c.5-.3.6-.9.2-1.3z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8h-3V4H3v11h2a3 3 0 0 0 6 0h2a3 3 0 0 0 6 0h2V8zM8 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm10 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm-1-7h3.5L18 13h-1V10z"/></svg>';
  }

  function resolveTrackingDataForDisplay(data) {
    if (!data.outForDeliveryToday) return data;
    var tz = resolveIanaTimeZone(data.toLocation) || "America/New_York";
    var now = new Date();
    var weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(now);
    var dateStr = formatDateInZone(now, tz);
    var timeline = (data.timeline || []).map(function (ev) {
      if (ev.title === "OUT FOR DELIVERY") {
        return Object.assign({}, ev, { date: dateStr + " 6:30 AM" });
      }
      return ev;
    });
    return Object.assign({}, data, {
      deliveryStatus: "Out For Delivery",
      estimatedDelivery: weekday + ", " + dateStr + " by end of day",
      statusNearPlace: formatStatusNearFromLocation(data.toLocation),
      timeline: timeline,
      _outForDeliveryScanAt: dateStr + " 12:01 AM",
      _outForDeliveryTz: tz
    });
  }

  function applyOutForDeliveryTodayScan(data) {
    if (!data._outForDeliveryScanAt || !data._outForDeliveryTz) return data;
    var timeline = (data.timeline || []).map(function (ev) {
      if (ev.title === "OUT FOR DELIVERY") {
        return Object.assign({}, ev, { date: data._outForDeliveryScanAt });
      }
      return ev;
    });
    var patched = Object.assign({}, data, { timeline: timeline });
    delete patched._outForDeliveryScanAt;
    delete patched._outForDeliveryTz;
    return patched;
  }

  function applyScanTimelineProgress(data) {
    var fallbackTz =
      resolveIanaTimeZone(data.fromLocation) ||
      resolveIanaTimeZone(data.toLocation) ||
      "America/New_York";
    var scans = [];
    var labelDate = data.labelCreatedDate;
    if (data.timeline && data.timeline.length && data.timeline[0].title === "LABEL CREATED") {
      labelDate = data.timeline[0].date || labelDate;
    }
    scans.push({
      stepTitle: "FROM",
      location: data.fromLocation,
      locationIncludes: null,
      at: parseUsDateTimeInZone(labelDate, fallbackTz)
    });
    (data.timeline || []).forEach(function (ev) {
      if (ev.title === "LABEL CREATED") return;
      var evTz = resolveIanaTimeZone(ev.location) || fallbackTz;
      scans.push({
        stepTitle: ev.title,
        location: ev.location,
        locationIncludes: locationMatchToken(ev.location),
        at: parseUsDateTimeInZone(ev.date, evTz)
      });
    });

    var now = Date.now();
    var latest = 0;
    for (var i = 0; i < scans.length; i++) {
      if (scans[i].at && scans[i].at.getTime() <= now) latest = i;
    }
    var scan = scans[latest];
    return {
      data: Object.assign({}, data, {
        deliveryStatus: deliveryStatusFromScanTitle(scan.stepTitle),
        statusNearPlace: formatStatusNearFromLocation(scan.location)
      }),
      stageIdx: latest,
      stage: {
        stepTitle: scan.stepTitle,
        locationIncludes:
          scan.stepTitle === "IN TRANSIT" || scan.stepTitle === "OUT FOR DELIVERY"
            ? scan.locationIncludes
            : null
      }
    };
  }

  function historyStageIndex(data, progressed) {
    var timeline = data.timeline || [];
    var historyStageIdx = 0;
    if (!progressed.stage) return historyStageIdx;
    if (progressed.stage.stepTitle === "FROM") return 0;
    for (var i = 0; i < timeline.length; i++) {
      if (timeline[i].title !== progressed.stage.stepTitle) continue;
      if (
        progressed.stage.locationIncludes &&
        String(timeline[i].location || "")
          .toUpperCase()
          .indexOf(String(progressed.stage.locationIncludes).toUpperCase()) === -1
      ) {
        continue;
      }
      historyStageIdx = i;
    }
    return historyStageIdx;
  }

  function resultRoot() {
    return document.getElementById("track-result");
  }

  function loadingState() {
    return (
      '<div class="mydsv-loading" aria-live="polite">' +
        "<h2>Looking up your shipment</h2>" +
        "<p>Checking the latest scan…</p>" +
        '<div class="mydsv-loading__bar" aria-hidden="true"><span></span></div>' +
      "</div>"
    );
  }

  function notFound(raw) {
    return (
      '<div class="mydsv-empty">' +
        "<h2>No shipment found for " + escapeHtml(raw) + "</h2>" +
        "<p>Check the ID and try again, or ask your sender for the correct tracking number.</p>" +
      "</div>"
    );
  }

  function emptyState() {
    return (
      '<div class="mydsv-empty">' +
        "<h2>Enter a shipment ID</h2>" +
        "<p>Use the homepage track form to open shipment details.</p>" +
        '<p><a href="/#track-shipment">Go to track form</a></p>' +
      "</div>"
    );
  }

  function field(label, value) {
    return (
      '<div class="mydsv-field">' +
        '<p class="mydsv-field__label">' + escapeHtml(label) + "</p>" +
        '<p class="mydsv-field__value">' + escapeHtml(value) + "</p>" +
      "</div>"
    );
  }

  function partyField(label, name, address) {
    var person = String(name || "").trim();
    var place = String(address || "").trim();
    var valueHtml = person
      ? '<span class="mydsv-field__name">' + escapeHtml(person) + "</span>" +
        (place ? '<span class="mydsv-field__address">' + escapeHtml(place) + "</span>" : "")
      : escapeHtml(place || "—");
    return (
      '<div class="mydsv-field">' +
        '<p class="mydsv-field__label">' + escapeHtml(label) + "</p>" +
        '<p class="mydsv-field__value mydsv-field__value--party">' + valueHtml + "</p>" +
      "</div>"
    );
  }

  function placeWithCode(loc) {
    var place = shortPlace(loc);
    if (!place) return "—";
    var parsed = parseUsCityStateFromLocation(String(loc || "").replace(/^FROM\s+/i, ""));
    if (parsed) {
      var code = (parsed.city.replace(/[^A-Za-z]/g, "").slice(0, 3) + parsed.state).toUpperCase();
      return parsed.city.toUpperCase() + " " + parsed.state + " (" + code + ")";
    }
    var near = place.toUpperCase();
    var letters = near.replace(/[^A-Z]/g, "").slice(0, 5);
    return near + (letters ? " (" + letters + ")" : "");
  }

  function traceTitle(label) {
    var map = {
      BOOKED: "Booking",
      "PICK-UP": "Pick-up / Received",
      "IN TRANSIT": "In Transit",
      "OUT FOR DELIVERY": "Out for Delivery",
      DELIVERED: "Delivery",
      EXCEPTION: "Delivery Exception"
    };
    return map[label] || titleCase(label);
  }

  function addressLine(loc) {
    return String(loc || "")
      .replace(/^FROM\s+/i, "")
      .replace(/,\s*USA$/i, "")
      .replace(/,\s*SOUTH AFRICA$/i, "")
      .replace(/,\s*AUSTRALIA$/i, "")
      .trim() || "—";
  }

  function packageImageUrl(data) {
    if (!data) return "";
    if (data.packageImage && String(data.packageImage).indexOf("data:image/") === 0) {
      return String(data.packageImage);
    }
    if (data.deliveryNotice && typeof data.deliveryNotice === "object" && data.deliveryNotice.packageImage) {
      return String(data.deliveryNotice.packageImage);
    }
    return "";
  }

  function hasRouteCoords(data) {
    function ok(v) {
      if (v == null || v === "") return false;
      return Number.isFinite(Number(v));
    }
    return !!(data && ok(data.fromLat) && ok(data.fromLon) && ok(data.toLat) && ok(data.toLon));
  }

  function routePoints(data) {
    var stops = Array.isArray(data.routeStops) ? data.routeStops : [];
    var pts = stops
      .filter(function (s) { return Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)); })
      .map(function (s) { return [Number(s.lat), Number(s.lon)]; });
    if (pts.length >= 2) return pts;
    if (!hasRouteCoords(data)) return [];
    return [[Number(data.fromLat), Number(data.fromLon)], [Number(data.toLat), Number(data.toLon)]];
  }

  function pointAtFraction(pts, frac) {
    frac = Math.max(0, Math.min(1, Number(frac) || 0));
    if (!pts || !pts.length) return null;
    if (pts.length < 2) return pts[0];
    var lens = [];
    var total = 0;
    var i;
    for (i = 0; i < pts.length - 1; i += 1) {
      var dlat = pts[i + 1][0] - pts[i][0];
      var dlon = pts[i + 1][1] - pts[i][1];
      var d = Math.sqrt(dlat * dlat + dlon * dlon);
      lens.push(d);
      total += d;
    }
    if (total <= 0) return pts[0];
    var target = frac * total;
    var acc = 0;
    for (i = 0; i < lens.length; i += 1) {
      var seg = lens[i];
      if (acc + seg >= target || i === lens.length - 1) {
        var local = seg ? (target - acc) / seg : 0;
        local = Math.max(0, Math.min(1, local));
        var a = pts[i];
        var b = pts[i + 1];
        return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }

  function progressFraction(data) {
    var s = String((data && data.status) || "").toLowerCase();
    if (s.indexOf("deliver") !== -1) return 1;
    if (s.indexOf("cancel") !== -1) return 0.15;
    var created = Date.parse((data && data.createdAt) || "");
    var eta = Date.parse((data && data.etaAt) || "");
    var now = Date.now();
    if (s.indexOf("hold") !== -1) {
      var held = Date.parse((data && data.heldAt) || "");
      if (Number.isFinite(created) && Number.isFinite(eta) && eta > created) {
        var freezeAt = Number.isFinite(held) ? held : now;
        return Math.max(0.05, Math.min(0.9, (freezeAt - created) / (eta - created)));
      }
      return 0.55;
    }
    if (Number.isFinite(created) && Number.isFinite(eta) && eta > created) {
      return Math.max(0.02, Math.min(0.98, (now - created) / (eta - created)));
    }
    if (s.indexOf("label") !== -1 || s === "pending") return 0.05;
    if (s.indexOf("out") !== -1) return 0.85;
    return 0.35;
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise(function (resolve, reject) {
      var cssId = "mydsv-leaflet-css";
      if (!document.getElementById(cssId)) {
        var link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      var existing = document.querySelector("script[data-mydsv-leaflet]");
      if (existing) {
        existing.addEventListener("load", function () { resolve(window.L); });
        existing.addEventListener("error", reject);
        return;
      }
      var script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.setAttribute("data-mydsv-leaflet", "1");
      script.onload = function () { resolve(window.L); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function resultCard(trackingNumber, rawData) {
    var progressed = applyScanTimelineProgress(
      applyOutForDeliveryTodayScan(resolveTrackingDataForDisplay(rawData))
    );
    var data = progressed.data;
    var currentIdx = historyStageIndex(data, progressed);
    var packageImg = packageImageUrl(data);
    var houseBill = data.houseBill || data.houseBillNumber || trackingNumber;
    var kind = modeKind(data.serviceType);
    var origin = placeWithCode(data.fromLocation);
    var destination = placeWithCode(data.toLocation);
    var senderName = data.sender || data.senderName || "";
    var receiverName = data.receiver || data.receiverName || "";
    var senderPlace = data.senderAddress || addressLine(data.fromLocation);
    var receiverPlace = data.receiverAddress || addressLine(data.toLocation);
    var timeline = (data.timeline || []).filter(function (event) {
      var title = String((event && event.title) || "").toUpperCase();
      // Never show hold-release notes on public tracking.
      return title !== "HOLD RELEASED";
    });
    // FedEx-style: only show history that has already taken place (no future est. hubs).
    var occurred = timeline.filter(function (_event, index) {
      return index <= currentIdx;
    });
    if (!occurred.length && timeline.length) occurred = [timeline[0]];
    var lastIdx = Math.max(0, occurred.length - 1);

    var progressItems = occurred
      .map(function (event, index) {
        var label = milestoneLabel(event.title);
        var place = shortPlace(event.location);
        var dateLine = formatDsvDate(event.date);
        var detail = label === "BOOKED" ? "Booking date" : place;
        var classes = ["mydsv-progress__item"];
        if (index < lastIdx) classes.push("is-done");
        if (index === lastIdx) classes.push("is-current");
        if (index === 0 || index === lastIdx) classes.push("is-endpoint");
        return (
          '<li class="' + classes.join(" ") + '">' +
            '<div class="mydsv-progress__rail" aria-hidden="true"><span class="mydsv-progress__dot"></span></div>' +
            "<div>" +
              '<p class="mydsv-progress__title">' + escapeHtml(label) + "</p>" +
              '<p class="mydsv-progress__meta">' + escapeHtml(detail) + "</p>" +
              '<p class="mydsv-progress__meta">' + escapeHtml(dateLine) + "</p>" +
            "</div>" +
          "</li>"
        );
      })
      .join("");

    var reverseTimeline = occurred.slice().reverse();
    var traceItems = reverseTimeline
      .map(function (event, reverseIndex) {
        var originalIndex = occurred.length - 1 - reverseIndex;
        var label = milestoneLabel(event.title);
        var place = placeWithCode(event.location);
        var dateLine = formatDsvDate(event.date);
        var check =
          '<span class="mydsv-trace-check" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.2 11.3 2.9 8l1.1-1.1 2.2 2.2 5-5L12.3 5z"/></svg></span>';
        return (
          '<details class="mydsv-trace-item"' + (originalIndex === lastIdx ? " open" : "") + ">" +
            "<summary>" +
              check +
              "<div>" +
                '<p class="mydsv-trace-title">' + escapeHtml(traceTitle(label)) + "</p>" +
                '<p class="mydsv-trace-sub">' + escapeHtml(dateLine) + "</p>" +
                (label === "BOOKED" ? "" : '<p class="mydsv-trace-sub">' + escapeHtml(place) + "</p>") +
              "</div>" +
              '<span class="mydsv-trace-chevron" aria-hidden="true">▾</span>' +
            "</summary>" +
            '<div class="mydsv-trace-body">' +
              "<p><strong>" + escapeHtml(event.title) + "</strong></p>" +
              "<p>" + escapeHtml(event.location || "—") + "</p>" +
              "<p>" + escapeHtml(dateLine) + "</p>" +
            "</div>" +
          "</details>"
        );
      })
      .join("");

    return (
      '<div class="mydsv-top">' +
        '<div class="mydsv-shipment-head">' +
          '<div class="mydsv-mode">' + modeIcon(kind) + "</div>" +
          "<div>" +
            '<h1>Shipment <button type="button" class="mydsv-copy-id" data-copy-id="' +
              escapeHtml(trackingNumber) +
              '" aria-label="Copy shipment id ' +
              escapeHtml(trackingNumber) +
              '" title="Tap to copy">' +
              escapeHtml(trackingNumber) +
              "</button></h1>" +
            (hasRouteCoords(data)
              ? '<button type="button" class="mydsv-view-route">View route</button>'
              : "") +
            (packageImg
              ? '<button type="button" class="mydsv-preview-package">Preview package</button>'
              : "") +
          "</div>" +
        "</div>" +
        statusAlertHtml(data) +
        '<div class="mydsv-progress-wrap">' +
          "<h2>Shipment Progress</h2>" +
          '<ol class="mydsv-progress">' + progressItems + "</ol>" +
        "</div>" +
        '<div class="mydsv-tabs" role="tablist" aria-label="Shipment views">' +
          '<button type="button" class="is-active" data-mydsv-tab="summary" role="tab" aria-selected="true">Summary</button>' +
          '<button type="button" data-mydsv-tab="trace" role="tab" aria-selected="false">Track &amp; Trace</button>' +
        "</div>" +
      "</div>" +
      '<div class="mydsv-panel" data-mydsv-panel="summary">' +
        '<section class="mydsv-card">' +
          '<h2 class="mydsv-section-title">Transport</h2>' +
          '<div class="mydsv-fields">' +
            field("House Bill number", houseBill) +
            field("Drop Off", "Pick-up by DSV") +
            field("Handover", "Delivery by DSV") +
            field("Origin", origin) +
            field("Destination", destination) +
          "</div>" +
        "</section>" +
        '<section class="mydsv-card">' +
          '<h2 class="mydsv-section-title">Sender / Receiver</h2>' +
          '<div class="mydsv-fields">' +
            partyField("Sender", senderName, senderPlace) +
            partyField("Receiver", receiverName, receiverPlace) +
          "</div>" +
        "</section>" +
        '<section class="mydsv-card">' +
          '<h2 class="mydsv-section-title">Pick-up / Delivery</h2>' +
          '<div class="mydsv-fields">' +
            field("Pick-up", addressLine(data.fromLocation)) +
            field("Delivery", addressLine(data.toLocation)) +
          "</div>" +
        "</section>" +
      "</div>" +
      '<div class="mydsv-panel" data-mydsv-panel="trace" hidden>' +
        '<div class="mydsv-trace-list">' + traceItems + "</div>" +
      "</div>"
    );
  }

  function bindTabs(root) {
    var tabs = root.querySelectorAll("[data-mydsv-tab]");
    var panels = root.querySelectorAll("[data-mydsv-panel]");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.getAttribute("data-mydsv-tab");
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        panels.forEach(function (panel) {
          panel.hidden = panel.getAttribute("data-mydsv-panel") !== name;
        });
      });
    });
  }

  function closePackagePreview() {
    var existing = document.getElementById("mydsv-package-lightbox");
    if (existing) existing.remove();
    if (!document.getElementById("mydsv-route-lightbox")) {
      document.body.classList.remove("mydsv-lightbox-open");
    }
  }

  function closeRouteMap() {
    var existing = document.getElementById("mydsv-route-lightbox");
    if (existing) {
      if (existing._mydsvMap) {
        try { existing._mydsvMap.remove(); } catch (_err) {}
        existing._mydsvMap = null;
      }
      existing.remove();
    }
    if (!document.getElementById("mydsv-package-lightbox")) {
      document.body.classList.remove("mydsv-lightbox-open");
    }
  }

  function openPackagePreview(src) {
    if (!src) return;
    closePackagePreview();
    var modal = document.createElement("div");
    modal.id = "mydsv-package-lightbox";
    modal.className = "mydsv-package-lightbox";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Package preview");
    modal.innerHTML =
      '<button type="button" class="mydsv-package-lightbox__backdrop" data-package-close aria-label="Close preview"></button>' +
      '<div class="mydsv-package-lightbox__panel">' +
        '<button type="button" class="mydsv-package-lightbox__close" data-package-close aria-label="Close">&times;</button>' +
        '<img src="' + escapeHtml(src) + '" alt="Package photo">' +
      "</div>";
    document.body.appendChild(modal);
    document.body.classList.add("mydsv-lightbox-open");
    modal.addEventListener("click", function (event) {
      if (event.target.closest("[data-package-close]")) closePackagePreview();
    });
  }

  function openRouteMap(data, trackingNumber) {
    closeRouteMap();
    var pts = routePoints(data);
    var modal = document.createElement("div");
    modal.id = "mydsv-route-lightbox";
    modal.className = "mydsv-route-lightbox";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Shipment route map");
    modal.innerHTML =
      '<button type="button" class="mydsv-route-lightbox__backdrop" data-route-close aria-label="Close map"></button>' +
      '<div class="mydsv-route-lightbox__panel">' +
        '<div class="mydsv-route-lightbox__head">' +
          "<div>" +
            "<h2>Shipment route</h2>" +
            "<p>" + escapeHtml(trackingNumber || data.id || "") + " · live position along route</p>" +
          "</div>" +
          '<button type="button" class="mydsv-route-lightbox__close" data-route-close aria-label="Close">&times;</button>' +
        "</div>" +
        (pts.length >= 2
          ? '<div class="mydsv-route-map" id="mydsv-route-map" role="img" aria-label="Map of shipment route"></div>'
          : '<p class="mydsv-route-lightbox__empty">Route map is not available for this shipment yet.</p>') +
      "</div>";
    document.body.appendChild(modal);
    document.body.classList.add("mydsv-lightbox-open");
    modal.addEventListener("click", function (event) {
      if (event.target.closest("[data-route-close]")) closeRouteMap();
    });

    if (pts.length < 2) return;

    loadLeaflet().then(function (L) {
      var mapEl = document.getElementById("mydsv-route-map");
      if (!mapEl || !L) return;
      var map = L.map(mapEl, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true
      });
      modal._mydsvMap = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      var line = L.polyline(pts, { color: "#0056b8", weight: 5, opacity: 0.9 }).addTo(map);
      L.circleMarker(pts[0], {
        radius: 7, color: "#002664", weight: 2, fillColor: "#fff", fillOpacity: 1
      }).addTo(map).bindTooltip("Origin · " + (data.fromLocation || "From"), { direction: "top" });
      L.circleMarker(pts[pts.length - 1], {
        radius: 7, color: "#78b820", weight: 2, fillColor: "#fff", fillOpacity: 1
      }).addTo(map).bindTooltip("Destination · " + (data.toLocation || "To"), { direction: "top" });

      var here = pointAtFraction(pts, progressFraction(data));
      if (here) {
        L.circleMarker(here, {
          radius: 9, color: "#fff", weight: 2, fillColor: "#0056b8", fillOpacity: 1
        }).addTo(map).bindPopup(
          "<strong>" + escapeHtml(trackingNumber || data.id || "Shipment") + "</strong><br>" +
          escapeHtml(data.deliveryStatus || data.status || "") + "<br>" +
          "<em>Current position</em>"
        ).openPopup();
      }

      map.fitBounds(line.getBounds(), { padding: [36, 36], maxZoom: 12 });
      window.setTimeout(function () {
        try { map.invalidateSize({ animate: false }); } catch (_err) {}
      }, 80);
      window.setTimeout(function () {
        try { map.invalidateSize({ animate: false }); } catch (_err) {}
      }, 320);
    }).catch(function () {
      var mapEl = document.getElementById("mydsv-route-map");
      if (mapEl) {
        mapEl.outerHTML = '<p class="mydsv-route-lightbox__empty">Could not load the map. Please try again.</p>';
      }
    });
  }

  function showCopyToast(message) {
    var existing = document.querySelector(".mydsv-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "mydsv-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = message || "Shipment id copied";
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add("is-visible");
    });
    setTimeout(function () {
      toast.classList.remove("is-visible");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, 2200);
  }

  function copyShipmentId(value) {
    var text = String(value || "").trim();
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return false; }
      );
    }
    return new Promise(function (resolve) {
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        resolve(!!ok);
      } catch (err) {
        resolve(false);
      }
    });
  }

  function bindShipmentActions(root, shipment, trackingNumber) {
    if (!root) return;
    // Re-bind on each paint so live refreshes keep the latest shipment data.
    if (root._mydsvActionsBound) {
      root.removeEventListener("click", root._mydsvActionsBound);
    }
    root._mydsvActionsBound = function (event) {
      var copyBtn = event.target.closest(".mydsv-copy-id");
      if (copyBtn) {
        event.preventDefault();
        var id = copyBtn.getAttribute("data-copy-id") || trackingNumber || copyBtn.textContent;
        copyShipmentId(id).then(function (ok) {
          if (ok) showCopyToast("Shipment id copied");
        });
        return;
      }
      var routeBtn = event.target.closest(".mydsv-view-route");
      if (routeBtn) {
        event.preventDefault();
        openRouteMap(shipment, trackingNumber);
        return;
      }
      var previewBtn = event.target.closest(".mydsv-preview-package");
      if (previewBtn) {
        event.preventDefault();
        openPackagePreview(packageImageUrl(shipment));
      }
    };
    root.addEventListener("click", root._mydsvActionsBound);
  }

  var detailsUnsub = null;
  var detailsReloadTimer = null;

  function paintDetails(root, id, shipment, raw, withDelay, flashLive) {
    var wait = withDelay ? Math.max(0, 700 - (Date.now() - withDelay)) : 0;
    setTimeout(function () {
      if (!shipment) {
        root.innerHTML = notFound(raw || id);
        return;
      }
      root.innerHTML = resultCard(id, shipment);
      bindTabs(root);
      bindShipmentActions(root, shipment, id);
      // Live updates refresh quietly — no blinking outline flash.
    }, wait);
  }

  function reloadDetailsLive(root, id, raw) {
    if (detailsReloadTimer) clearTimeout(detailsReloadTimer);
    detailsReloadTimer = setTimeout(function () {
      findShipmentAsync(id).then(function (shipment) {
        if (!shipment) {
          root.innerHTML = notFound(raw || id);
          return;
        }
        window.DSV_SHIPMENTS = window.DSV_SHIPMENTS || {};
        window.DSV_SHIPMENTS[id] = shipment;
        paintDetails(root, id, shipment, raw, 0, true);
      });
    }, 120);
  }

  function subscribeDetailsLive(root, id, raw) {
    ensureRealtimeScript().then(function (rt) {
      if (!rt || !rt.subscribeShipments) return;
      rt.subscribeShipments({
        id: id,
        onChange: function (evt) {
          if (evt.eventType === "DELETE") {
            root.innerHTML = notFound(raw || id);
            return;
          }
          reloadDetailsLive(root, id, raw);
        }
      }).then(function (unsub) {
        detailsUnsub = unsub;
      });
    });
  }

  function renderDetails() {
    var root = resultRoot();
    if (!root || !isDetailsPage()) return;

    var params = new URLSearchParams(window.location.search);
    var raw = params.get("id") || params.get("query") || "";
    var id = normalizeId(raw);

    if (!id) {
      root.innerHTML = emptyState();
      return;
    }

    document.title = "Shipment " + id + " | myDSV";
    root.innerHTML = loadingState();

    if (typeof detailsUnsub === "function") {
      detailsUnsub();
      detailsUnsub = null;
    }

    var started = Date.now();
    findShipmentAsync(id).then(function (shipment) {
      paintDetails(root, id, shipment, raw, started);
    });

    subscribeDetailsLive(root, id, raw);
  }

  function bindHomeForms() {
    if (isDetailsPage()) return;

    var forms = document.querySelectorAll(
      "form.js-tracking-form, form.js-tracking-dsv-form, form.js-tracking-schenker-form, form.tracking-form"
    );
    forms.forEach(function (form) {
      form.setAttribute("action", DETAILS_PATH);
      form.setAttribute("method", "get");
      var input = form.querySelector("input[type='text'], input:not([type='hidden'])");
      if (input) {
        if (!input.getAttribute("name") || input.getAttribute("name") === "query") {
          input.setAttribute("name", "id");
        }
      }

      function submitToDetails(event) {
        event.preventDefault();
        event.stopPropagation();
        var field = form.querySelector("input[name='id'], input[name='query'], input[type='text']");
        var raw = field ? field.value.trim() : "";
        var id = parseFirstTrackingNumber(raw);
        if (!id) {
          if (field) field.focus();
          return;
        }
        goToDetails(id);
      }

      form.addEventListener("submit", submitToDetails, true);
      var button = form.querySelector("button, [type='submit']");
      if (button) button.addEventListener("click", submitToDetails, true);
    });

    document.querySelectorAll('a[href="#track-shipment"]').forEach(function (link) {
      link.addEventListener("click", function (event) {
        var form = document.getElementById("track-shipment");
        if (!form) return;
        event.preventDefault();
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        var input = form.querySelector("input[name='id'], input[name='query'], input[type='text']");
        if (input) setTimeout(function () { input.focus(); }, 350);
      });
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closeRouteMap();
    closePackagePreview();
  });

  function init() {
    bindHomeForms();
    renderDetails();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);

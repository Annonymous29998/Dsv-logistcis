(function (global) {
  "use strict";

  var maps = {};

  function hasCoords(row) {
    // Number(null) === 0 — treat missing coords as unmapped so they can be repaired.
    function ok(v) {
      if (v == null || v === "") return false;
      return Number.isFinite(Number(v));
    }
    return row && ok(row.fromLat) && ok(row.fromLon) && ok(row.toLat) && ok(row.toLon);
  }

  function statusColor(status) {
    var s = String(status || "").toLowerCase();
    if (s.indexOf("deliver") !== -1) return "#10B981";
    if (s.indexOf("hold") !== -1 || s.indexOf("exception") !== -1) return "#F59E0B";
    if (s.indexOf("cancel") !== -1) return "#EF4444";
    if (s.indexOf("out") !== -1) return "#38bdf8";
    return "#0866F5";
  }

  function routePoints(row) {
    var stops = Array.isArray(row.routeStops) ? row.routeStops : [];
    var pts = stops
      .filter(function (s) { return Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)); })
      .map(function (s) { return [Number(s.lat), Number(s.lon)]; });
    if (pts.length >= 2) return pts;
    return [[Number(row.fromLat), Number(row.fromLon)], [Number(row.toLat), Number(row.toLon)]];
  }

  function pointAtFraction(pts, frac) {
    frac = Math.max(0, Math.min(1, Number(frac) || 0));
    if (!pts || !pts.length) return null;
    if (pts.length < 2) return pts[0];
    var lens = [];
    var total = 0;
    for (var i = 0; i < pts.length - 1; i += 1) {
      var dlat = pts[i + 1][0] - pts[i][0];
      var dlon = pts[i + 1][1] - pts[i][1];
      var d = Math.sqrt(dlat * dlat + dlon * dlon);
      lens.push(d);
      total += d;
    }
    if (total <= 0) return pts[0];
    var target = frac * total;
    var acc = 0;
    for (var j = 0; j < lens.length; j += 1) {
      var seg = lens[j];
      if (acc + seg >= target || j === lens.length - 1) {
        var local = seg ? (target - acc) / seg : 0;
        local = Math.max(0, Math.min(1, local));
        var a = pts[j];
        var b = pts[j + 1];
        return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }

  function hasStartedTransit(row) {
    var timeline = Array.isArray(row && row.timeline) ? row.timeline : [];
    for (var i = 0; i < timeline.length; i += 1) {
      var title = String((timeline[i] && timeline[i].title) || "").toUpperCase();
      if (
        title === "IN TRANSIT" ||
        title === "OUT FOR DELIVERY" ||
        title === "DELIVERED" ||
        title === "TO"
      ) {
        return true;
      }
    }
    var s = String((row && row.status) || "").toLowerCase();
    return s.indexOf("out") !== -1 || s.indexOf("deliver") !== -1;
  }

  function progressFraction(row) {
    var s = String(row.status || "").toLowerCase();
    if (s.indexOf("deliver") !== -1) return 1;
    if (s.indexOf("cancel") !== -1) return 0;

    // Stay at origin until the first IN TRANSIT scan — not at label created / pick-up.
    if (!hasStartedTransit(row)) {
      if (s.indexOf("hold") !== -1) return 0;
      return 0;
    }

    var created = Date.parse(row.createdAt || "");
    var eta = Date.parse(row.etaAt || "");
    var paused = Number(row.holdPausedMs || 0) || 0;
    if (
      row.deliveryNotice &&
      typeof row.deliveryNotice === "object" &&
      Number(row.deliveryNotice.holdPausedMs) > 0
    ) {
      paused = Number(row.deliveryNotice.holdPausedMs) || paused;
    }
    var now = Date.now();
    if (Number.isFinite(created) && Number.isFinite(eta) && eta > created) {
      var end = now;
      // On hold: freeze marker at the hold moment (route does not keep moving).
      if (s.indexOf("hold") !== -1) {
        var held = Date.parse(row.heldAt || "");
        end = Number.isFinite(held) ? held : now;
      }
      var elapsed = Math.max(0, end - created - paused);
      var total = Math.max(1, eta - created - paused);
      return Math.max(0.02, Math.min(0.98, elapsed / total));
    }

    if (s.indexOf("hold") !== -1) return 0.55;
    if (s.indexOf("out") !== -1) return 0.85;
    return 0.35;
  }

  function progressPoint(row) {
    return pointAtFraction(routePoints(row), progressFraction(row));
  }

  function stopLive(id) {
    var state = maps[id];
    if (state && state.liveTimer) {
      window.clearInterval(state.liveTimer);
      state.liveTimer = null;
    }
  }

  function tickLive(id) {
    var state = maps[id];
    if (!state || !state.byId) return;
    if (!isMapAttached(state, null)) {
      stopLive(id);
      return;
    }
    Object.keys(state.byId).forEach(function (sid) {
      var item = state.byId[sid];
      if (!item || !item.marker || !item.row) return;
      var here = progressPoint(item.row);
      if (!here) return;
      try {
        item.marker.setLatLng(here);
      } catch (e) {}
    });
  }

  function destroy(id) {
    stopLive(id);
    if (maps[id]) {
      try {
        if (maps[id].ro) maps[id].ro.disconnect();
      } catch (e) {}
      try { maps[id].map.remove(); } catch (e2) {}
      delete maps[id];
    }
  }

  var LEAFLET_SOURCES = [
    {
      css: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
      js: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"
    },
    {
      css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
      js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    },
    {
      css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
      js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"
    }
  ];

  var leafletPromise = null;

  function ensureCss(href) {
    if (document.querySelector('link[data-dsv-leaflet-css="' + href + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-dsv-leaflet-css", href);
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-dsv-leaflet-js="' + src + '"]');
      if (existing) {
        if (global.L) return resolve(global.L);
        existing.addEventListener("load", function () { resolve(global.L); });
        existing.addEventListener("error", reject);
        return;
      }
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.setAttribute("data-dsv-leaflet-js", src);
      script.onload = function () {
        if (global.L) resolve(global.L);
        else reject(new Error("Leaflet missing after load"));
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function ensureLeaflet() {
    if (global.L) return Promise.resolve(global.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = (function trySource(index) {
      if (index >= LEAFLET_SOURCES.length) {
        return Promise.reject(new Error("Leaflet CDNs unavailable"));
      }
      var source = LEAFLET_SOURCES[index];
      ensureCss(source.css);
      return loadScript(source.js).catch(function () {
        return trySource(index + 1);
      });
    })(0);
    leafletPromise = leafletPromise.catch(function (err) {
      leafletPromise = null;
      throw err;
    });
    return leafletPromise;
  }

  function keepMapFresh(map, container, fitFn) {
    function refresh() {
      if (!map || !container) return;
      if (container.clientWidth < 40 || container.clientHeight < 40) return;
      try {
        map.invalidateSize({ animate: false });
        if (typeof fitFn === "function") fitFn();
      } catch (e) {}
    }
    [60, 200, 500, 1200, 2500, 5000].forEach(function (ms) {
      window.setTimeout(refresh, ms);
    });
    var ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(function () { refresh(); });
      try { ro.observe(container); } catch (e) {}
    }
    function onVis() {
      if (!document.hidden) refresh();
    }
    document.addEventListener("visibilitychange", onVis);
    map.whenReady(refresh);
    return ro;
  }

  function fitToRow(map, row, maxZoom) {
    if (!map || !row) return;
    var pts = routePoints(row);
    if (!pts.length) return;
    map.fitBounds(pts, { padding: [40, 40], maxZoom: maxZoom || 12 });
  }

  function wireKeyboardPan(container, map) {
    // Wheel zoom on hover/focus only — no click required.
    var hovered = false;
    var focused = false;

    container.setAttribute("tabindex", "0");
    container.setAttribute("role", "application");
    container.setAttribute(
      "aria-label",
      (container.getAttribute("aria-label") || "Live shipment map") +
        ". Hover or focus to scroll-zoom and use arrow keys to pan. Drag to move."
    );

    function syncZoom() {
      if (hovered || focused) {
        map.scrollWheelZoom.enable();
        map.keyboard.enable();
      } else {
        map.scrollWheelZoom.disable();
      }
    }

    container.addEventListener("mouseenter", function () {
      hovered = true;
      syncZoom();
    });
    container.addEventListener("mouseleave", function () {
      hovered = false;
      syncZoom();
    });
    container.addEventListener("focus", function () {
      focused = true;
      syncZoom();
    });
    container.addEventListener("blur", function () {
      focused = false;
      syncZoom();
    });

    // Keep wheel zoom working while the pointer is over the map even if
    // focus moves (e.g. after clicking a marker popup).
    container.addEventListener("wheel", function () {
      if (hovered && !map.scrollWheelZoom.enabled()) {
        map.scrollWheelZoom.enable();
      }
    }, { passive: true });
  }

  var mapConfigPromise = null;

  function loadMapConfig() {
    if (mapConfigPromise) return mapConfigPromise;
    mapConfigPromise = fetch("/api/public/config", { credentials: "same-origin", cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return data && data.ok ? data : {}; })
      .catch(function () { return {}; });
    return mapConfigPromise;
  }

  function geoapifyTileLayer(apiKey) {
    if (!apiKey || !global.L) return null;
    return global.L.tileLayer(
      "https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=" + encodeURIComponent(apiKey),
      {
        maxZoom: 20,
        attribution:
          'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | &copy; OpenStreetMap'
      }
    );
  }

  function addBasemap(map) {
    var esriTiles = global.L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles &copy; Esri" }
    );
    var osmFrTiles = global.L.tileLayer(
      "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      {
        maxZoom: 20,
        subdomains: "abc",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / osmfr'
      }
    );
    var active = null;
    var gotTile = false;
    var queueIndex = 0;
    var queue = [];

    function markTile() {
      gotTile = true;
    }

    function useLayer(layer) {
      if (!layer || !map) return;
      if (active && map.hasLayer(active) && active !== layer) {
        try { map.removeLayer(active); } catch (e) {}
      }
      active = layer;
      if (!map.hasLayer(layer)) layer.addTo(map);
      layer.off("tileload", markTile);
      layer.off("load", markTile);
      layer.on("tileload", markTile);
      layer.on("load", markTile);
    }

    function armErrors(layer, onFail) {
      var errors = 0;
      layer.on("tileerror", function () {
        errors += 1;
        if (errors >= 2) onFail();
      });
    }

    function tryNext() {
      if (gotTile) return;
      queueIndex += 1;
      if (queueIndex >= queue.length) return;
      useLayer(queue[queueIndex]);
      armErrors(queue[queueIndex], tryNext);
      window.setTimeout(function () {
        if (!gotTile) tryNext();
      }, 2800);
    }

    // Show Esri immediately so the map is never blank while config loads.
    queue = [esriTiles, osmFrTiles];
    useLayer(esriTiles);
    armErrors(esriTiles, tryNext);
    window.setTimeout(function () {
      if (!gotTile) tryNext();
    }, 2800);

    loadMapConfig().then(function (cfg) {
      var geo = geoapifyTileLayer(cfg && cfg.geoapifyApiKey);
      if (!geo) return;
      // Prefer Geoapify when available — insert as first fallback after current.
      queue = [active || esriTiles, geo, esriTiles, osmFrTiles].filter(function (layer, idx, arr) {
        return layer && arr.indexOf(layer) === idx;
      });
      if (!gotTile) {
        useLayer(geo);
        armErrors(geo, tryNext);
        queueIndex = queue.indexOf(geo);
      }
    });
  }

  function createMap(container) {
    return global.L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
      keyboard: true,
      keyboardPanDelta: 80,
      dragging: true,
      doubleClickZoom: true,
      boxZoom: true
    });
  }

  function isMapAttached(state, container) {
    if (!state || !state.map) return false;
    var el = null;
    try {
      el = state.map.getContainer();
    } catch (e) {
      return false;
    }
    if (!el) return false;
    // After dashboard re-render, root.innerHTML replaces the node — old map is orphaned.
    if (container && el !== container) return false;
    if (typeof el.isConnected === "boolean" && !el.isConnected) return false;
    if (!document.body || !document.body.contains(el)) return false;
    return true;
  }

  function syncExisting(id, shipments, options) {
    var state = maps[id];
    if (!state || !state.map || !state.byId) return false;
    if (!isMapAttached(state, null)) return false;
    var rows = (shipments || []).filter(hasCoords);
    var nextIds = rows.map(function (r) { return r.id; }).sort().join("|");
    var prevIds = (state.rows || []).map(function (r) { return r.id; }).sort().join("|");
    if (nextIds !== prevIds) return false;

    state.options = options || state.options || {};
    rows.forEach(function (row) {
      var item = state.byId[row.id];
      if (!item) return;
      item.row = row;
      var color = statusColor(row.status);
      item.color = color;
      var isFocus = state.focusId === row.id || (state.options.focusId && state.options.focusId === row.id);
      if (item.line) {
        item.line.setStyle({
          color: color,
          weight: isFocus ? 5 : 3,
          opacity: isFocus ? 0.9 : 0.35
        });
      }
      if (item.marker) {
        var here = progressPoint(row);
        if (here) item.marker.setLatLng(here);
        item.marker.setStyle({
          fillColor: color,
          radius: isFocus ? 8 : 5
        });
        item.marker.setPopupContent(
          "<strong>" + String(row.id) + "</strong><br>" +
          (row.deliveryStatus || row.status || "") + "<br>" +
          (row.statusNearPlace || "") +
          "<br><em>Live position along route</em>"
        );
      }
    });
    state.rows = rows;
    if (state.options.focusId) focusShipment(id, state.options.focusId);
    try { state.map.invalidateSize({ animate: false }); } catch (e) {}
    return true;
  }

  function mountNow(container, shipments, options) {
    options = options || {};
    if (!container || !global.L) return null;

    var id = container.id || ("map-" + Math.random().toString(36).slice(2, 8));
    container.id = id;

    // Reuse only if this Leaflet instance is still the visible DOM node.
    // Live refresh replaces #view-root HTML; without this check the map goes blank
    // while we keep updating an orphaned (detached) map instance.
    if (maps[id] && isMapAttached(maps[id], container) && syncExisting(id, shipments, options)) {
      return maps[id].map;
    }

    destroy(id);

    var rows = (shipments || []).filter(hasCoords);
    container.classList.remove("map-canvas--empty");
    container.innerHTML = "";

    var map = createMap(container);
    addBasemap(map);
    wireKeyboardPan(container, map);

    // No shipments yet: still show a real map (world overview).
    if (!rows.length) {
      map.setView([20, 0], 2);
      maps[id] = {
        map: map,
        rows: [],
        byId: {},
        focusId: null,
        options: options,
        maxZoom: options.maxZoom || 12,
        liveTimer: null,
        ro: keepMapFresh(map, container, null)
      };
      return map;
    }

    var focus = options.focusId
      ? rows.find(function (r) { return r.id === options.focusId; })
      : rows.find(function (r) {
          var s = String(r.status || "").toLowerCase();
          return s.indexOf("transit") !== -1 || s.indexOf("out") !== -1;
        }) || rows[0];

    var byId = {};
    rows.forEach(function (row) {
      var pts = routePoints(row);
      var color = statusColor(row.status);
      var isFocus = row === focus;

      var line = global.L.polyline(pts, {
        color: color,
        weight: isFocus ? 5 : 3,
        opacity: isFocus ? 0.9 : 0.35
      }).addTo(map);

      global.L.circleMarker(pts[0], {
        radius: isFocus ? 6 : 4, color: "#0B1F3A", weight: 2, fillColor: "#fff", fillOpacity: 1
      }).addTo(map).bindTooltip("Origin · " + (row.fromLocation || row.id), { direction: "top" });

      global.L.circleMarker(pts[pts.length - 1], {
        radius: isFocus ? 6 : 4, color: color, weight: 2, fillColor: "#fff", fillOpacity: 1
      }).addTo(map).bindTooltip("Destination · " + (row.toLocation || row.id), { direction: "top" });

      var here = progressPoint(row);
      var marker = null;
      if (here) {
        marker = global.L.circleMarker(here, {
          radius: isFocus ? 8 : 5,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1
        }).addTo(map);
        marker.bindPopup(
          "<strong>" + String(row.id) + "</strong><br>" +
          (row.deliveryStatus || row.status || "") + "<br>" +
          (row.statusNearPlace || "") +
          "<br><em>Live position along route</em>"
        );
        if (isFocus) marker.openPopup();
        marker.on("click", function () {
          focusShipment(id, row.id);
          if (typeof options.onFocus === "function") options.onFocus(row);
        });
      }

      byId[row.id] = { row: row, pts: pts, line: line, marker: marker, color: color };
    });

    maps[id] = {
      map: map,
      rows: rows,
      byId: byId,
      focusId: focus && focus.id,
      options: options,
      maxZoom: options.maxZoom || 12,
      liveTimer: window.setInterval(function () { tickLive(id); }, 4000),
      ro: null
    };

    fitToRow(map, focus, options.maxZoom || 12);
    maps[id].ro = keepMapFresh(map, container, function () {
      fitToRow(map, focus, options.maxZoom || 12);
    });

    return map;
  }

  function focusShipment(containerId, shipmentId) {
    var state = maps[containerId];
    if (!state) return false;
    var entry = state.byId[shipmentId];
    if (!entry) return false;

    Object.keys(state.byId).forEach(function (id) {
      var item = state.byId[id];
      var active = id === shipmentId;
      if (item.line) {
        item.line.setStyle({
          weight: active ? 5 : 3,
          opacity: active ? 0.9 : 0.35
        });
      }
      if (item.marker) {
        item.marker.setStyle({ radius: active ? 8 : 5 });
        if (active) item.marker.openPopup();
        else item.marker.closePopup();
      }
    });

    state.focusId = shipmentId;
    fitToRow(state.map, entry.row, state.maxZoom);
    try {
      state.map.getContainer().focus({ preventScroll: true });
    } catch (e) {
      state.map.getContainer().focus();
    }
    return true;
  }

  function mount(container, shipments, options) {
    if (!container) return null;
    options = options || {};
    container.classList.remove("map-canvas--empty");
    if (!maps[container.id] && !container.querySelector(".leaflet-pane")) {
      container.innerHTML = '<div class="map-note">Loading map…</div>';
    }

    function attempt(attemptNo) {
      ensureLeaflet()
        .then(function () {
          mountNow(container, shipments, options);
        })
        .catch(function () {
          container.classList.remove("map-canvas--empty");
          container.innerHTML = '<div class="map-note">Loading map…</div>';
          window.setTimeout(function () {
            attempt((attemptNo || 0) + 1);
          }, Math.min(8000, 1200 + (attemptNo || 0) * 800));
        });
    }

    if (global.L) return mountNow(container, shipments, options);
    attempt(0);
    return null;
  }

  function refreshAll() {
    Object.keys(maps).forEach(function (id) {
      var state = maps[id];
      if (!state || !state.map) return;
      try {
        state.map.invalidateSize({ animate: false });
        if (state.focusId && state.byId[state.focusId]) {
          fitToRow(state.map, state.byId[state.focusId].row, state.maxZoom || 12);
        }
      } catch (e) {}
    });
  }

  global.AdminMap = {
    mount: mount,
    destroy: destroy,
    focusShipment: focusShipment,
    hasCoords: hasCoords,
    refreshAll: refreshAll,
    ensureLeaflet: ensureLeaflet
  };
})(window);

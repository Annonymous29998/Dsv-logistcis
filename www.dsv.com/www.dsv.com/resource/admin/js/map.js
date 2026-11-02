(function (global) {
  "use strict";

  var maps = {};

  function hasCoords(row) {
    return row && Number.isFinite(Number(row.fromLat)) && Number.isFinite(Number(row.fromLon)) &&
      Number.isFinite(Number(row.toLat)) && Number.isFinite(Number(row.toLon));
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

  function progressPoint(row) {
    var pts = routePoints(row);
    if (pts.length < 2) return pts[0] || null;
    var s = String(row.status || "").toLowerCase();
    var frac = 0.35;
    if (s.indexOf("label") !== -1 || s === "pending") frac = 0.05;
    else if (s.indexOf("out") !== -1) frac = 0.85;
    else if (s.indexOf("deliver") !== -1) frac = 1;
    else if (s.indexOf("hold") !== -1) frac = 0.55;
    else if (s.indexOf("cancel") !== -1) frac = 0.2;
    var idx = Math.min(pts.length - 2, Math.floor(frac * (pts.length - 1)));
    var local = frac * (pts.length - 1) - idx;
    var a = pts[idx];
    var b = pts[idx + 1];
    return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
  }

  function destroy(id) {
    if (maps[id]) {
      try { maps[id].map.remove(); } catch (e) {}
      delete maps[id];
    }
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

  function addBasemap(map) {
    // Free raster tiles — no API key. OSM first, Esri fallback if OSM fails.
    var osmTiles = global.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    });
    var esriTiles = global.L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri"
      }
    );
    var tileErrors = 0;
    osmTiles.on("tileerror", function () {
      tileErrors += 1;
      if (tileErrors >= 3 && map.hasLayer(osmTiles)) {
        map.removeLayer(osmTiles);
        if (!map.hasLayer(esriTiles)) esriTiles.addTo(map);
      }
    });
    osmTiles.addTo(map);
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

  function mountNow(container, shipments, options) {
    options = options || {};
    if (!container || !global.L) return null;

    var id = container.id || ("map-" + Math.random().toString(36).slice(2, 8));
    container.id = id;
    destroy(id);

    var rows = (shipments || []).filter(hasCoords);
    container.classList.remove("map-canvas--empty");
    container.innerHTML = "";

    var map = createMap(container);
    addBasemap(map);
    wireKeyboardPan(container, map);

    // No shipments yet: still show a real map (world overview).
    if (!rows.length) {
      maps[id] = {
        map: map,
        rows: [],
        byId: {},
        focusId: null,
        options: options,
        maxZoom: options.maxZoom || 12
      };
      map.setView([20, 0], 2);
      function refreshEmpty() {
        try { map.invalidateSize({ animate: false }); } catch (e) {}
      }
      window.setTimeout(refreshEmpty, 80);
      window.setTimeout(refreshEmpty, 320);
      window.setTimeout(refreshEmpty, 800);
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
          "<br><em>Click marker to focus this route</em>"
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
      maxZoom: options.maxZoom || 12
    };

    fitToRow(map, focus, options.maxZoom || 12);

    function refreshSize() {
      try {
        map.invalidateSize({ animate: false });
        fitToRow(map, focus, options.maxZoom || 12);
      } catch (e) {}
    }
    window.setTimeout(refreshSize, 80);
    window.setTimeout(refreshSize, 320);
    window.setTimeout(refreshSize, 800);

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
    if (global.L) return mountNow(container, shipments, options);
    var tries = 0;
    var timer = window.setInterval(function () {
      tries += 1;
      if (global.L) {
        window.clearInterval(timer);
        mountNow(container, shipments, options);
      } else if (tries > 40) {
        window.clearInterval(timer);
        container.innerHTML = '<div class="map-note">Map library failed to load. Refresh the page.</div>';
        container.classList.add("map-canvas--empty");
      }
    }, 100);
    return null;
  }

  global.AdminMap = {
    mount: mount,
    destroy: destroy,
    focusShipment: focusShipment,
    hasCoords: hasCoords
  };
})(window);

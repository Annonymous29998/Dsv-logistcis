(function (global) {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeStatus(status) {
    var s = String(status || "").toLowerCase();
    if (s.indexOf("cancel") !== -1) return "cancelled";
    if (s.indexOf("hold") !== -1) return "on-hold";
    if (s.indexOf("exception") !== -1) return "exception";
    if (s.indexOf("out-for-delivery") !== -1) return "out-for-delivery";
    if (s.indexOf("deliver") !== -1) return "delivered";
    if (s.indexOf("transit") !== -1) return "in-transit";
    return s || "pending";
  }

  function statusLabel(status) {
    return ({
      "in-transit": "In Transit",
      "out-for-delivery": "Out for Delivery",
      delivered: "Delivered",
      "on-hold": "On Hold",
      cancelled: "Cancelled",
      exception: "Delayed / Exception",
      pending: "Pending"
    })[normalizeStatus(status)] || status;
  }

  function statusClass(status) {
    var s = normalizeStatus(status);
    if (s === "exception" || s === "on-hold") return "badge exception";
    if (s === "cancelled") return "badge pending";
    return "badge " + s;
  }

  function shortPlace(loc) {
    return String(loc || "")
      .replace(/^FROM\s+/i, "")
      .replace(/,\s*USA$/i, "")
      .replace(/,\s*SOUTH AFRICA$/i, "")
      .replace(/,\s*AUSTRALIA$/i, "")
      .trim()
      .split(",")
      .slice(-2)
      .join(",")
      .trim() || "—";
  }

  function cityOnly(loc) {
    return shortPlace(loc).split(",")[0].trim() || "—";
  }

  function summarize(shipments) {
    var summary = {
      total: shipments.length,
      inTransit: 0,
      outForDelivery: 0,
      delivered: 0,
      pending: 0,
      exception: 0,
      active: 0
    };
    shipments.forEach(function (row) {
      var status = normalizeStatus(row.status);
      if (status === "delivered") summary.delivered += 1;
      else if (status === "out-for-delivery") summary.outForDelivery += 1;
      else if (status === "in-transit") summary.inTransit += 1;
      else if (status === "exception") {
        summary.exception += 1;
        summary.pending += 1;
      } else summary.pending += 1;
    });
    summary.active = summary.inTransit + summary.outForDelivery;
    return summary;
  }

  function customersFromShipments(shipments) {
    var map = {};
    shipments.forEach(function (row) {
      var key = (row.receiver || "Unknown") + "|" + shortPlace(row.toLocation);
      if (!map[key]) {
        map[key] = {
          name: row.receiver || "Unknown",
          location: shortPlace(row.toLocation),
          shipments: 0,
          lastStatus: row.status,
          lastId: row.id
        };
      }
      map[key].shipments += 1;
      map[key].lastStatus = row.status;
      map[key].lastId = row.id;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function hubsFromShipments(shipments) {
    var map = {};
    shipments.forEach(function (row) {
      var hub = row.statusNearPlace || shortPlace(row.lastLocation || row.toLocation);
      map[hub] = (map[hub] || 0) + 1;
    });
    return Object.keys(map).map(function (name) {
      return { name: name, count: map[name] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  function backendNote(feature) {
    return (
      '<div class="backend-note"><strong>' + escapeHtml(feature) + "</strong><br>" +
      "This section uses your live shipment book where available. Extra modules can be wired in later.</div>"
    );
  }

  global.AdminUtils = {
    escapeHtml: escapeHtml,
    normalizeStatus: normalizeStatus,
    statusLabel: statusLabel,
    statusClass: statusClass,
    shortPlace: shortPlace,
    cityOnly: cityOnly,
    summarize: summarize,
    customersFromShipments: customersFromShipments,
    hubsFromShipments: hubsFromShipments,
    backendNote: backendNote
  };
})(window);

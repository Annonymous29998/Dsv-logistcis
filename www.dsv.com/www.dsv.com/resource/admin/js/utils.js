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
    var s = String(status || "").toLowerCase().replace(/\s+/g, "-");
    if (s.indexOf("cancel") !== -1) return "cancelled";
    if (s.indexOf("hold") !== -1) return "on-hold";
    if (s.indexOf("exception") !== -1) return "exception";
    if (s.indexOf("out-for-delivery") !== -1 || s === "out-for-delivery") return "out-for-delivery";
    // Avoid matching "label-created" / "pending" against the word "deliver".
    if (s === "delivered" || s.indexOf("delivered") !== -1) return "delivered";
    if (s.indexOf("transit") !== -1) return "in-transit";
    if (s.indexOf("label") !== -1) return "label-created";
    if (s === "pending") return "pending";
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
      pending: "Pending",
      "label-created": "Label Created"
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
      onHold: 0,
      cancelled: 0,
      active: 0
    };
    shipments.forEach(function (row) {
      var status = normalizeStatus(row.status);
      if (status === "delivered") summary.delivered += 1;
      else if (status === "out-for-delivery") summary.outForDelivery += 1;
      else if (status === "in-transit") summary.inTransit += 1;
      else if (status === "on-hold") {
        summary.onHold += 1;
        summary.exception += 1;
        summary.pending += 1;
      } else if (status === "cancelled") summary.cancelled += 1;
      else if (status === "exception") {
        summary.exception += 1;
        summary.pending += 1;
      } else if (status === "pending" || status === "label-created") summary.pending += 1;
      else summary.pending += 1;
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

  function ensureToastHost() {
    var host = document.getElementById("admin-toast-host");
    if (host) return host;
    host = document.createElement("div");
    host.id = "admin-toast-host";
    host.className = "admin-toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions");
    document.body.appendChild(host);
    return host;
  }

  function toast(options) {
    options = options || {};
    var type = options.type === "error" || options.type === "warn" ? options.type : "success";
    var title = String(options.title || (type === "success" ? "Saved" : type === "warn" ? "Notice" : "Error"));
    var message = String(options.message || "");
    var host = ensureToastHost();
    var el = document.createElement("div");
    el.className = "admin-toast admin-toast--" + type;
    el.setAttribute("role", "status");
    el.innerHTML =
      '<div class="admin-toast__body">' +
        "<strong>" + escapeHtml(title) + "</strong>" +
        (message ? "<p>" + escapeHtml(message) + "</p>" : "") +
      "</div>" +
      '<button type="button" class="admin-toast__close" aria-label="Dismiss">&times;</button>';
    host.appendChild(el);
    window.requestAnimationFrame(function () {
      el.classList.add("is-visible");
    });

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      el.classList.remove("is-visible");
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }
    el.querySelector(".admin-toast__close").addEventListener("click", close);
    window.setTimeout(close, Number(options.duration) || (type === "error" ? 5200 : 3200));
    return close;
  }

  function confirmDangerZone(options) {
    options = options || {};
    return new Promise(function (resolve) {
      var existing = document.getElementById("danger-confirm-modal");
      if (existing) existing.remove();

      var modal = document.createElement("div");
      modal.id = "danger-confirm-modal";
      modal.className = "danger-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      var title = options.title || "Danger zone";
      var showBadge = options.showBadge !== false && String(title).toLowerCase() !== "danger zone";
      modal.innerHTML =
        '<div class="danger-modal__backdrop" data-danger-cancel="1"></div>' +
        '<div class="danger-modal__panel">' +
          (showBadge ? '<div class="danger-modal__badge">Danger zone</div>' : "") +
          "<h3>" + escapeHtml(title) + "</h3>" +
          "<p>" + escapeHtml(
            options.message ||
            "Clear all shipment data from the live book. Public tracking links will stop working until you create new shipments."
          ) + "</p>" +
          (options.detail
            ? '<ul class="danger-modal__list">' +
              [].concat(options.detail).map(function (item) {
                return "<li>" + escapeHtml(item) + "</li>";
              }).join("") +
              "</ul>"
            : "") +
          '<div class="danger-modal__actions">' +
            '<button type="button" class="btn" data-danger-cancel="1">' +
              escapeHtml(options.cancelLabel || "No") +
            "</button>" +
            '<button type="button" class="btn btn-danger" id="danger-confirm-yes">' +
              escapeHtml(options.confirmLabel || "Yes") +
            "</button>" +
          "</div>" +
        "</div>";
      document.body.appendChild(modal);

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        modal.remove();
        resolve(value);
      }

      modal.addEventListener("click", function (event) {
        if (event.target.closest("[data-danger-cancel]")) finish(false);
      });
      modal.querySelector("#danger-confirm-yes").addEventListener("click", function () {
        finish(true);
      });
      document.addEventListener("keydown", function onKey(event) {
        if (!document.getElementById("danger-confirm-modal")) {
          document.removeEventListener("keydown", onKey);
          return;
        }
        if (event.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          finish(false);
        }
      });
      window.setTimeout(function () {
        var yes = modal.querySelector("#danger-confirm-yes");
        if (yes) yes.focus();
      }, 30);
    });
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
    backendNote: backendNote,
    toast: toast,
    confirmDangerZone: confirmDangerZone
  };
})(window);

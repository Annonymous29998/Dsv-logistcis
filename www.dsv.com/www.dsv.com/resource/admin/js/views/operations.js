(function (global) {
  "use strict";
  function U() { return global.AdminUtils; }

  function shipmentsView(root, ctx) {
    var q = (ctx.query || "").toLowerCase();
    var status = ctx.filters.status || "all";
    var rows = ctx.shipments.filter(function (row) {
      if (status !== "all" && U().normalizeStatus(row.status) !== status) return false;
      if (!q) return true;
      var hay = [row.id, row.sender, row.receiver, row.fromLocation, row.toLocation, row.serviceType].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    root.innerHTML =
      '<div class="welcome"><div><h1>Shipments</h1><p>Live consignments from the tracking book.</p></div>' +
      '<div style="display:flex;gap:.55rem;flex-wrap:wrap">' +
        '<button type="button" class="btn" id="btn-create-shipment">Create shipment</button>' +
        (ctx.shipments.length
          ? '<button type="button" class="btn btn-danger" id="btn-clear-all-shipments">Clear all data</button>'
          : "") +
      "</div></div>" +
      '<div class="toolbar">' +
        '<select id="filter-status"><option value="all">All statuses</option><option value="in-transit">In Transit</option><option value="out-for-delivery">Out for Delivery</option><option value="delivered">Delivered</option><option value="exception">Pending / Exception</option></select>' +
        '<span style="color:var(--muted);font-weight:600">' + rows.length + " shown</span>" +
      "</div>" +
      '<article class="card"><div class="table-wrap"><table class="shipments-table"><thead><tr>' +
        "<th>Tracking</th><th>Customer</th><th>Origin</th><th>Destination</th><th>Service</th><th>ETA</th><th>Status</th><th></th>" +
      "</tr></thead><tbody>" +
      rows.map(function (row) {
        return '<tr data-open-id="' + U().escapeHtml(row.id) + '">' +
          '<td class="mono">' + U().escapeHtml(row.id) + "</td>" +
          "<td>" + U().escapeHtml(row.receiver || "—") + "</td>" +
          "<td>" + U().escapeHtml(U().cityOnly(row.fromLocation)) + "</td>" +
          "<td>" + U().escapeHtml(U().cityOnly(row.toLocation)) + "</td>" +
          "<td>" + U().escapeHtml(row.serviceType || "—") + "</td>" +
          "<td>" + U().escapeHtml(row.estimatedDelivery || "—") + "</td>" +
          '<td><span class="' + U().statusClass(row.status) + '">' + U().escapeHtml(U().statusLabel(row.status)) + "</span></td>" +
          '<td><button type="button" class="btn" data-open-id="' + U().escapeHtml(row.id) + '">View</button></td>' +
        "</tr>";
      }).join("") +
      (rows.length ? "" : '<tr><td colspan="8" class="empty">No shipments match your filters.</td></tr>') +
      "</tbody></table></div></article>";

    var select = document.getElementById("filter-status");
    if (select) {
      select.value = status;
      select.addEventListener("change", function () {
        ctx.filters.status = select.value;
        shipmentsView(root, ctx);
      });
    }
    var createBtn = document.getElementById("btn-create-shipment");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        if (!global.AdminViews.createShipment) return;
        var open = global.AdminViews.createShipment.open || global.AdminViews.createShipment.render;
        open(ctx, function (created, newId) {
          if (!created) return;
          AdminAPI.shipments().then(function (data) {
            ctx.shipments = data.shipments || [];
            if (typeof ctx.announceShipmentChange === "function") {
              ctx.announceShipmentChange(newId, "INSERT");
            }
            shipmentsView(root, ctx);
            if (newId && typeof ctx.openShipment === "function") ctx.openShipment(newId);
          }).catch(function () {
            shipmentsView(root, ctx);
          });
        });
      });
    }
    var clearBtn = document.getElementById("btn-clear-all-shipments");
    if (clearBtn && typeof ctx.clearAllShipmentData === "function") {
      clearBtn.addEventListener("click", function () {
        ctx.clearAllShipmentData();
      });
    }
  }

  function trackingView(root, ctx) {
    var moving = ctx.shipments.filter(function (r) {
      var s = U().normalizeStatus(r.status);
      return s === "in-transit" || s === "out-for-delivery";
    });
    root.innerHTML =
      '<div class="welcome"><div><h1>Live Tracking</h1><p>Active moves from the current book.</p></div></div>' +
      '<div class="grid-2">' +
        '<article class="card"><div class="card__head"><h2>Network map</h2><span class="pill">' +
          moving.length + ' active</span></div><div class="card__body">' +
          '<div class="map-stage"><div class="map-canvas map-canvas--tall" id="tracking-network-map" aria-label="Network map of active shipments"></div></div>' +
        "</div></article>" +
        '<article class="card"><div class="card__head"><h2>Moving now</h2></div><div class="card__body table-wrap"><table class="table-compact"><thead><tr><th>ID</th><th>Near</th><th>Status</th></tr></thead><tbody>' +
        moving.map(function (row) {
          return '<tr data-open-id="' + U().escapeHtml(row.id) + '"><td class="mono">' + U().escapeHtml(row.id) + "</td><td>" +
            U().escapeHtml(row.statusNearPlace || U().shortPlace(row.lastLocation)) + '</td><td><span class="' +
            U().statusClass(row.status) + '">' + U().escapeHtml(U().statusLabel(row.status)) + "</span></td></tr>";
        }).join("") +
        (moving.length ? "" : '<tr><td colspan="3" class="empty">No active moves.</td></tr>') +
        "</tbody></table></div></article></div>";

    if (global.AdminMap) {
      global.AdminMap.mount(
        document.getElementById("tracking-network-map"),
        moving.length ? moving : ctx.shipments,
        { maxZoom: 10 }
      );
    }
  }

  function customersView(root, ctx) {
    var customers = U().customersFromShipments(ctx.shipments);
    root.innerHTML =
      '<div class="welcome"><div><h1>Customers</h1><p>Derived from shipment receivers in the tracking book.</p></div></div>' +
      '<article class="card"><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Location</th><th>Shipments</th><th>Latest status</th><th></th></tr></thead><tbody>' +
      customers.map(function (c) {
        return "<tr><td>" + U().escapeHtml(c.name) + "</td><td>" + U().escapeHtml(c.location) + "</td><td>" + c.shipments +
          '</td><td><span class="' + U().statusClass(c.lastStatus) + '">' + U().escapeHtml(U().statusLabel(c.lastStatus)) +
          '</span></td><td><button type="button" class="btn" data-open-id="' + U().escapeHtml(c.lastId) + '">History</button></td></tr>';
      }).join("") +
      "</tbody></table></div></article>";
  }

  function fleetView(root, ctx) {
    var summary = U().summarize(ctx.shipments);
    root.innerHTML =
      '<div class="welcome"><div><h1>Fleet Management</h1><p>Operational estimates until a fleet registry API is connected.</p></div></div>' +
      U().backendNote("Vehicle registry / maintenance records") +
      '<div class="kpi-row" style="margin-top:1rem">' +
        '<article class="kpi"><div class="kpi__label">Active moves</div><div class="kpi__value">' + summary.active + '</div><div class="kpi__trend">From shipment statuses</div></article>' +
        '<article class="kpi"><div class="kpi__label">Exceptions</div><div class="kpi__value">' + summary.exception + '</div><div class="kpi__trend">May imply holds / workshop impact</div></article>' +
      "</div>";
  }

  function driversView(root) {
    root.innerHTML =
      '<div class="welcome"><div><h1>Drivers</h1><p>Driver profiles and assignments.</p></div></div>' +
      U().backendNote("Driver directory, availability, and assignment APIs");
  }

  function warehousesView(root, ctx) {
    var hubs = U().hubsFromShipments(ctx.shipments);
    root.innerHTML =
      '<div class="welcome"><div><h1>Warehouses</h1><p>Hub concentration from latest shipment positions.</p></div></div>' +
      '<article class="card"><div class="card__body">' +
      hubs.map(function (h, i) {
        return '<div style="display:flex;justify-content:space-between;gap:1rem;padding:.85rem 0;border-bottom:1px solid var(--line)">' +
          "<div><strong>" + String(i + 1).padStart(2, "0") + " · " + U().escapeHtml(h.name) + "</strong>" +
          '<div style="color:var(--muted);font-size:.8rem;margin-top:.2rem">' + h.count + " active touchpoints</div></div>" +
          "<strong>" + h.count + "</strong></div>";
      }).join("") +
      (hubs.length ? "" : '<p class="empty">No hub activity.</p>') +
      "</div></article>";
  }

  global.AdminViews = global.AdminViews || {};
  global.AdminViews.shipments = { render: shipmentsView };
  global.AdminViews.tracking = { render: trackingView };
  global.AdminViews.customers = { render: customersView };
  global.AdminViews.fleet = { render: fleetView };
  global.AdminViews.drivers = { render: driversView };
  global.AdminViews.warehouses = { render: warehousesView };
})(window);

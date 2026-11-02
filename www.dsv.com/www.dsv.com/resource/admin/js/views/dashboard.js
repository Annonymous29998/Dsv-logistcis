(function (global) {
  "use strict";
  var U = null;
  function utils() { return U || (U = global.AdminUtils); }

  var chartInstance = null;

  function kpiCard(label, value, iconClass, iconSvg, trendHtml) {
    return (
      '<article class="kpi"><div class="kpi__top"><div>' +
        '<div class="kpi__label">' + utils().escapeHtml(label) + "</div>" +
        '<div class="kpi__value">' + utils().escapeHtml(String(value)) + "</div>" +
        (trendHtml || "") +
      '</div><div class="kpi__icon ' + iconClass + '">' + iconSvg + "</div></div></article>"
    );
  }

  function render(root, ctx) {
    var summary = utils().summarize(ctx.shipments);
    var recent = ctx.shipments.slice(0, 8);

    var onRoad = summary.active;
    var available = Math.max(0, summary.total - summary.active);
    var maintenance = summary.exception;
    var fleetTotal = Math.max(1, onRoad + available + maintenance);
    var p1 = ((onRoad / fleetTotal) * 100).toFixed(1) + "%";
    var p2 = (((onRoad + maintenance) / fleetTotal) * 100).toFixed(1) + "%";
    var held = ctx.shipments.filter(function (r) {
      var s = utils().normalizeStatus(r.status);
      return s === "on-hold" || s === "exception";
    }).length;
    var cancelled = ctx.shipments.filter(function (r) {
      return utils().normalizeStatus(r.status) === "cancelled";
    }).length;
    var completion = summary.total
      ? Math.round((summary.delivered / summary.total) * 100) + "%"
      : "0%";

    var liveMoves = ctx.shipments.filter(function (r) {
      var s = utils().normalizeStatus(r.status);
      return s === "in-transit" || s === "out-for-delivery" || s === "on-hold";
    });
    if (!liveMoves.length && ctx.shipments[0]) liveMoves = [ctx.shipments[0]];
    var liveIndex = 0;
    var live = liveMoves[0] || null;

    function liveCardHtml(row, index, total) {
      if (!row) return "";
      return (
        '<div class="live-card" id="dashboard-live-card">' +
          '<div class="live-card__nav">' +
            '<button type="button" class="live-card__arrow" data-live-prev aria-label="Previous active shipment"' +
              (total < 2 ? " disabled" : "") + ">‹</button>" +
            '<span class="live-card__count">' + (index + 1) + " / " + total + " active</span>" +
            '<button type="button" class="live-card__arrow" data-live-next aria-label="Next active shipment"' +
              (total < 2 ? " disabled" : "") + ">›</button>" +
          "</div>" +
          '<div class="live-card__id">#' + utils().escapeHtml(String(row.id).slice(-6)) +
            '<span class="live-card__id-full"> · ' + utils().escapeHtml(row.id) + "</span></div>" +
          '<div style="margin:.45rem 0"><span class="' + utils().statusClass(row.status) + '">' +
            utils().escapeHtml(utils().statusLabel(row.status)) + "</span></div>" +
          "<strong>" + utils().escapeHtml(utils().cityOnly(row.fromLocation)) + " → " +
            utils().escapeHtml(utils().cityOnly(row.toLocation)) + "</strong>" +
          '<p style="margin:.35rem 0 .65rem;color:var(--muted);font-size:.78rem">' +
            utils().escapeHtml(row.estimatedDelivery || "ETA updating…") + "</p>" +
          '<p class="live-card__hint">Scroll-zoom on hover · arrows to pan · ‹ › to switch routes.</p>' +
          '<button type="button" class="btn btn-primary" data-open-id="' + utils().escapeHtml(row.id) + '">View details</button>' +
        "</div>"
      );
    }

    function showLive(index) {
      if (!liveMoves.length) return;
      liveIndex = ((index % liveMoves.length) + liveMoves.length) % liveMoves.length;
      live = liveMoves[liveIndex];
      var cardHost = document.getElementById("dashboard-live-card");
      if (cardHost) {
        var wrap = document.createElement("div");
        wrap.innerHTML = liveCardHtml(live, liveIndex, liveMoves.length);
        cardHost.replaceWith(wrap.firstChild);
      }
      if (global.AdminMap) {
        global.AdminMap.focusShipment("dashboard-live-map", live.id);
      }
    }

    root.innerHTML =
      '<div class="welcome">' +
        "<div><h1>Welcome Back, Admin!</h1><p>Here's what's happening with your logistics operations today.</p></div>" +
        '<div class="date-pill" id="date-range">Live book · ' + new Date().toLocaleDateString() + "</div>" +
      "</div>" +
      '<div class="kpi-row">' +
        kpiCard("Total Shipments", summary.total, "blue", iconBox(), '<div class="kpi__trend">Live tracking book</div>') +
        kpiCard("In Transit", summary.active, "green", iconTruck(), '<div class="kpi__trend up">Includes out for delivery</div>') +
        kpiCard("Delivered", summary.delivered, "orange", iconCheck(), '<div class="kpi__trend">' + completion + " completion</div>") +
        kpiCard("Pending / Delayed", summary.pending, "red", iconClock(), summary.exception ? '<div class="kpi__trend down">' + summary.exception + " exceptions</div>" : "") +
      "</div>" +
      '<div class="kpi-row">' +
        kpiCard("Out for Delivery", summary.outForDelivery, "blue", iconTruck(), '<div class="kpi__trend">Ready for last mile</div>') +
        kpiCard("On Hold", held, "orange", iconAlert(), cancelled ? '<div class="kpi__trend">' + cancelled + " cancelled</div>" : '<div class="kpi__trend">Needs attention</div>') +
        kpiCard("Active Routes", onRoad, "green", iconUser(), '<div class="kpi__trend">Moves currently on the road</div>') +
        kpiCard("Book Capacity", fleetTotal, "red", iconCash(), '<div class="kpi__trend">Active + pending slots</div>') +
      "</div>" +
      '<div class="grid-2">' +
        '<article class="card"><div class="card__head"><h2>Shipment performance</h2><span class="pill">Current book</span></div><div class="card__body"><div class="chart-wrap"><canvas id="shipments-chart"></canvas></div></div></article>' +
        '<article class="card"><div class="card__head"><h2>Live shipment map</h2><span class="pill">' +
          liveMoves.length + " active move" + (liveMoves.length === 1 ? "" : "s") +
        '</span></div><div class="card__body">' +
          '<div class="map-stage">' +
            '<div class="map-canvas" id="dashboard-live-map" aria-label="Live shipment map"></div>' +
            liveCardHtml(live, liveIndex, liveMoves.length) +
          "</div></div></article>" +
      "</div>" +
      '<div class="grid-2">' +
        '<article class="card"><div class="card__head"><h2>Recent shipments</h2><button type="button" class="pill" data-nav="shipments" style="cursor:pointer">View all</button></div>' +
          '<div class="card__body table-wrap"><table class="table-compact"><thead><tr><th>Tracking</th><th>Route</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
          recent.map(function (row) {
            return '<tr data-open-id="' + utils().escapeHtml(row.id) + '"><td class="mono">' + utils().escapeHtml(row.id) + "</td><td>" +
              utils().escapeHtml(utils().cityOnly(row.fromLocation)) + " → " + utils().escapeHtml(utils().cityOnly(row.toLocation)) +
              '</td><td><span class="' + utils().statusClass(row.status) + '">' + utils().escapeHtml(utils().statusLabel(row.status)) + "</span></td><td>" +
              utils().escapeHtml(row.lastDate || "—") + "</td></tr>";
          }).join("") +
          "</tbody></table></div></article>" +
        '<article class="card"><div class="card__head"><h2>Fleet status</h2></div><div class="card__body">' +
          '<div class="donut" style="--p1:' + p1 + ";--p2:" + p2 + ';"><div class="donut__center"><strong>' + fleetTotal + '</strong><span>Derived units</span></div></div>' +
          '<div class="fleet-legend">' +
            "<div><span>On road (active moves)</span><strong>" + onRoad + "</strong></div>" +
            "<div><span>Available (idle book slots)</span><strong>" + available + "</strong></div>" +
            "<div><span>Exception / hold</span><strong>" + maintenance + "</strong></div>" +
          '</div><p class="backend-note" style="margin-top:.85rem">Fleet split is calculated from live shipment statuses in your book.</p>' +
        "</div></article>" +
      "</div>";

    if (typeof ctx.updateChatNotifications === "function") ctx.updateChatNotifications({ silent: true });

    root.addEventListener("click", function (event) {
      var prev = event.target.closest("[data-live-prev]");
      var next = event.target.closest("[data-live-next]");
      if (prev) {
        event.preventDefault();
        showLive(liveIndex - 1);
      } else if (next) {
        event.preventDefault();
        showLive(liveIndex + 1);
      }
    });

    if (global.AdminMap) {
      global.AdminMap.mount(document.getElementById("dashboard-live-map"), ctx.shipments, {
        focusId: live && live.id,
        onFocus: function (row) {
          var idx = liveMoves.findIndex(function (r) { return r.id === row.id; });
          if (idx < 0) {
            liveMoves.push(row);
            idx = liveMoves.length - 1;
          }
          liveIndex = idx;
          live = row;
          var cardHost = document.getElementById("dashboard-live-card");
          if (cardHost) {
            var wrap = document.createElement("div");
            wrap.innerHTML = liveCardHtml(live, liveIndex, liveMoves.length);
            cardHost.replaceWith(wrap.firstChild);
          }
        }
      });
    }

    var canvas = document.getElementById("shipments-chart");
    if (canvas && global.Chart) {
      if (chartInstance) chartInstance.destroy();
      var chartData = [
        summary.inTransit || 0,
        summary.outForDelivery || 0,
        summary.delivered || 0,
        summary.pending || 0
      ];
      // Empty book still draws a muted ring so the chart area never looks blank.
      var hasData = chartData.some(function (n) { return n > 0; });
      chartInstance = new global.Chart(canvas, {
        type: "doughnut",
        data: {
          labels: ["In Transit", "Out for Delivery", "Delivered", "Pending / Exception"],
          datasets: [{
            data: hasData ? chartData : [1],
            backgroundColor: hasData
              ? ["#0866F5", "#38bdf8", "#10B981", "#F59E0B"]
              : ["#e2e8f0"],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          layout: { padding: { top: 8, bottom: 4, left: 8, right: 8 } },
          plugins: {
            legend: {
              display: hasData,
              position: "bottom",
              labels: {
                boxWidth: 10,
                boxHeight: 10,
                padding: 12,
                font: { size: 11, family: "Manrope, system-ui, sans-serif" }
              }
            },
            tooltip: { enabled: hasData }
          }
        }
      });
      window.requestAnimationFrame(function () {
        try { if (chartInstance) chartInstance.resize(); } catch (e) {}
      });
    }
  }

  function iconBox() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>'; }
  function iconTruck() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h13v10H3z"/><path d="M16 10h4l1 3v4h-5V10z"/></svg>'; }
  function iconCheck() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>'; }
  function iconClock() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'; }
  function iconCash() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>'; }
  function iconUser() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'; }
  function iconAlert() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>'; }
  global.AdminViews = global.AdminViews || {};
  global.AdminViews.dashboard = { render: render };
})(window);

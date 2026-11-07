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
    var fleetUnits = onRoad + available + maintenance;
    var hasBook = (summary.total || 0) > 0;
    var fleetTotal = hasBook ? Math.max(fleetUnits, summary.total) : 0;
    var fleetDenom = Math.max(1, fleetUnits);
    var p1 = hasBook ? ((onRoad / fleetDenom) * 100).toFixed(1) + "%" : "0%";
    var p2 = hasBook ? (((onRoad + maintenance) / fleetDenom) * 100).toFixed(1) + "%" : "0%";
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
        // User chose a shipment — fitting the route is intentional.
        global.AdminMap.focusShipment("dashboard-live-map", live.id);
      }
    }

    function wireDashboardChrome() {
      if (typeof ctx.updateChatNotifications === "function") ctx.updateChatNotifications({ silent: true });
      var clearBtn = document.getElementById("btn-clear-all-data");
      if (clearBtn && !clearBtn.getAttribute("data-bound")) {
        clearBtn.setAttribute("data-bound", "1");
        clearBtn.addEventListener("click", function () {
          if (typeof ctx.clearAllShipmentData === "function") ctx.clearAllShipmentData();
        });
      }
      if (!root.getAttribute("data-live-nav-bound")) {
        root.setAttribute("data-live-nav-bound", "1");
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
      }
    }

    function mountLiveMap() {
      if (!global.AdminMap) return;
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

    // Soft refresh: keep the existing Leaflet map (and user zoom/pan) when live data updates.
    var existingMap = root.querySelector("#dashboard-live-map.leaflet-container");
    if (existingMap && root.querySelector(".card--map-hero")) {
      var pill = root.querySelector(".card--map-hero .pill");
      if (pill) {
        pill.textContent =
          liveMoves.length + " active move" + (liveMoves.length === 1 ? "" : "s");
      }
      var cardHost = document.getElementById("dashboard-live-card");
      if (cardHost && live) {
        var wrap = document.createElement("div");
        wrap.innerHTML = liveCardHtml(live, liveIndex, liveMoves.length);
        cardHost.replaceWith(wrap.firstChild);
      }
      var kpis = root.querySelectorAll(".kpi__value");
      var kpiValues = [
        summary.total,
        summary.active,
        summary.delivered,
        summary.pending,
        summary.outForDelivery,
        held,
        onRoad,
        fleetTotal
      ];
      for (var ki = 0; ki < kpis.length && ki < kpiValues.length; ki += 1) {
        kpis[ki].textContent = String(kpiValues[ki]);
      }
      wireDashboardChrome();
      mountLiveMap();
      mountPerformanceChart(0);
      return;
    }

    root.innerHTML =
      '<div class="welcome">' +
        "<div><h1>Welcome Back, Admin!</h1><p>Here's what's happening with your logistics operations today.</p></div>" +
        '<div class="welcome__actions">' +
          '<button type="button" class="btn btn-danger-outline" id="btn-clear-all-data">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
            "Clear all data" +
          "</button>" +
          '<div class="date-pill" id="date-range">Live book · ' + new Date().toLocaleDateString() + "</div>" +
        "</div>" +
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
      '<article class="card card--map-hero">' +
        '<div class="card__head"><h2>Live shipment map</h2><span class="pill">' +
          liveMoves.length + " active move" + (liveMoves.length === 1 ? "" : "s") +
        "</span></div>" +
        '<div class="card__body">' +
          '<div class="map-stage map-stage--hero">' +
            '<div class="map-canvas map-canvas--hero" id="dashboard-live-map" aria-label="Live shipment map"></div>' +
            liveCardHtml(live, liveIndex, liveMoves.length) +
          "</div>" +
        "</div>" +
      "</article>" +
      '<div class="grid-2">' +
        '<article class="card"><div class="card__head"><h2>Shipment performance</h2><span class="pill">Current book</span></div><div class="card__body"><div class="chart-wrap" id="shipments-chart-wrap"><canvas id="shipments-chart"></canvas><p class="chart-empty" id="shipments-chart-empty" hidden>No shipment data yet. Create a tracking to see performance.</p></div></div></article>' +
        '<article class="card"><div class="card__head"><h2>Fleet status</h2></div><div class="card__body">' +
          (hasBook
            ? '<div class="donut" style="--p1:' + p1 + ";--p2:" + p2 + ';"><div class="donut__center"><strong>' + fleetTotal + '</strong><span>Derived units</span></div></div>' +
              '<div class="fleet-legend">' +
                "<div><span>On road (active moves)</span><strong>" + onRoad + "</strong></div>" +
                "<div><span>Available (idle book slots)</span><strong>" + available + "</strong></div>" +
                "<div><span>Exception / hold</span><strong>" + maintenance + "</strong></div>" +
              '</div><p class="backend-note" style="margin-top:.85rem">Fleet split is calculated from live shipment statuses in your book.</p>'
            : '<div class="fleet-empty"><p class="chart-empty chart-empty--static">No shipment data yet. Create a tracking to see fleet status.</p></div>') +
        "</div></article>" +
      "</div>" +
      '<div class="grid-2 grid-2--recent">' +
        '<article class="card card--recent"><div class="card__head"><h2>Recent shipments</h2><button type="button" class="pill" data-nav="shipments" style="cursor:pointer">View all</button></div>' +
          '<div class="card__body table-wrap"><table class="table-compact"><thead><tr><th>Tracking</th><th>Route</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
          recent.map(function (row) {
            return '<tr data-open-id="' + utils().escapeHtml(row.id) + '"><td class="mono">' + utils().escapeHtml(row.id) + "</td><td>" +
              utils().escapeHtml(utils().cityOnly(row.fromLocation)) + " → " + utils().escapeHtml(utils().cityOnly(row.toLocation)) +
              '</td><td><span class="' + utils().statusClass(row.status) + '">' + utils().escapeHtml(utils().statusLabel(row.status)) + "</span></td><td>" +
              utils().escapeHtml(row.lastDate || "—") + "</td></tr>";
          }).join("") +
          "</tbody></table></div></article>" +
      "</div>";

    wireDashboardChrome();
    mountLiveMap();

    function mountPerformanceChart(attempt) {
      var canvas = document.getElementById("shipments-chart");
      var emptyEl = document.getElementById("shipments-chart-empty");
      if (!canvas) return;

      var labels = ["In Transit", "Out for Delivery", "Delivered", "On Hold", "Pending", "Cancelled"];
      var pendingOnly = Math.max(
        0,
        (summary.total || 0) -
          (summary.inTransit || 0) -
          (summary.outForDelivery || 0) -
          (summary.delivered || 0) -
          (summary.onHold || 0) -
          (summary.cancelled || 0)
      );
      var chartData = [
        summary.inTransit || 0,
        summary.outForDelivery || 0,
        summary.delivered || 0,
        summary.onHold || 0,
        pendingOnly,
        summary.cancelled || 0
      ];

      var hasShipments = (summary.total || 0) > 0;
      var pairs = labels.map(function (label, i) {
        return { label: label, value: chartData[i] || 0 };
      }).filter(function (row) { return row.value > 0; });

      if (!hasShipments) {
        if (chartInstance) {
          try { chartInstance.destroy(); } catch (e) {}
          chartInstance = null;
        }
        if (emptyEl) {
          emptyEl.hidden = false;
          emptyEl.style.display = "grid";
        }
        canvas.style.display = "none";
        return;
      }
      if (emptyEl) {
        emptyEl.hidden = true;
        emptyEl.style.display = "none";
      }
      canvas.style.display = "block";

      if (!global.Chart) {
        if ((attempt || 0) < 40) {
          window.setTimeout(function () { mountPerformanceChart((attempt || 0) + 1); }, 100);
        }
        return;
      }

      if (chartInstance) {
        try { chartInstance.destroy(); } catch (e) {}
        chartInstance = null;
      }

      chartInstance = new global.Chart(canvas, {
        type: "doughnut",
        data: {
          labels: pairs.length ? pairs.map(function (p) { return p.label; }) : labels,
          datasets: [{
            data: pairs.length ? pairs.map(function (p) { return p.value; }) : chartData,
            backgroundColor: pairs.length
              ? pairs.map(function (p) {
                  return ({
                    "In Transit": "#0866F5",
                    "Out for Delivery": "#38bdf8",
                    Delivered: "#10B981",
                    "On Hold": "#F59E0B",
                    Pending: "#94a3b8",
                    Cancelled: "#ef4444"
                  })[p.label] || "#94a3b8";
                })
              : ["#0866F5", "#38bdf8", "#10B981", "#F59E0B", "#94a3b8", "#ef4444"],
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
              display: true,
              position: "bottom",
              labels: {
                boxWidth: 10,
                boxHeight: 10,
                padding: 12,
                font: { size: 11, family: "Manrope, system-ui, sans-serif" }
              }
            },
            tooltip: { enabled: true }
          }
        }
      });
      window.requestAnimationFrame(function () {
        try { if (chartInstance) chartInstance.resize(); } catch (e) {}
      });
    }

    mountPerformanceChart(0);
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

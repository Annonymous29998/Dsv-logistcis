(function () {
  "use strict";

  var AUTH_KEY = "dsv-admin-auth";
  var CHAT_KEY = "dsv-live-support-chats";
  var CHAT_CHANNEL = "dsv-live-support";
  var DETAILS_PATH = "/new/tracking/shipment-details-public";

  var state = {
    view: "dashboard",
    query: "",
    statusFilter: "all",
    serviceFilter: "all",
    selectedChatId: null,
    liveId: null
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shipmentsMap() {
    return window.DSV_SHIPMENTS || {};
  }

  function normalizeStatus(status) {
    var s = String(status || "").toLowerCase().replace(/\s+/g, "-");
    if (s.indexOf("exception") !== -1 || s.indexOf("hold") !== -1) return "exception";
    if (s.indexOf("out-for-delivery") !== -1) return "out-for-delivery";
    if (s.indexOf("deliver") !== -1) return "delivered";
    if (s.indexOf("transit") !== -1) return "in-transit";
    return s || "unknown";
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
    var s = shortPlace(loc);
    return s.split(",")[0].trim() || s;
  }

  function parseLooseDate(value) {
    var s = String(value || "").trim();
    var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
    if (!m) {
      var d = Date.parse(s);
      return isNaN(d) ? 0 : d;
    }
    var hour = Number(m[4] || 0);
    var ap = (m[6] || "").toUpperCase();
    if (ap === "PM" && hour < 12) hour += 12;
    if (ap === "AM" && hour === 12) hour = 0;
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5] || 0)).getTime();
  }

  function listShipments() {
    return Object.keys(shipmentsMap()).map(function (id) {
      var s = shipmentsMap()[id];
      var last = s.timeline && s.timeline.length ? s.timeline[s.timeline.length - 1] : null;
      return {
        id: id,
        status: normalizeStatus(s.status),
        deliveryStatus: s.deliveryStatus || s.status || "Unknown",
        serviceType: s.serviceType || "DSV Road",
        sender: s.sender || "—",
        receiver: s.receiver || "—",
        fromLocation: s.fromLocation || "—",
        toLocation: s.toLocation || "—",
        near: s.statusNearPlace || shortPlace(last && last.location),
        packageContent: s.packageContent || "—",
        signatureRequired: !!s.signatureRequired,
        estimatedDelivery: s.estimatedDelivery || "—",
        notice: (s.deliveryNotice && (s.deliveryNotice.en || s.deliveryNotice)) || "",
        timeline: s.timeline || [],
        lastEvent: last ? last.title : "—",
        lastDate: last ? last.date : s.labelCreatedDate || "",
        labelCreatedDate: s.labelCreatedDate || "—"
      };
    }).sort(function (a, b) {
      return parseLooseDate(b.lastDate) - parseLooseDate(a.lastDate);
    });
  }

  function metrics(rows) {
    var m = { total: rows.length, transit: 0, ofd: 0, delivered: 0, pending: 0 };
    rows.forEach(function (r) {
      if (r.status === "in-transit") m.transit += 1;
      else if (r.status === "out-for-delivery") m.ofd += 1;
      else if (r.status === "delivered") m.delivered += 1;
      else m.pending += 1;
    });
    m.onTransit = m.transit + m.ofd;
    return m;
  }

  function statusLabel(status) {
    return ({
      "in-transit": "In Transit",
      "out-for-delivery": "Out for Delivery",
      delivered: "Delivered",
      exception: "Pending",
      unknown: "Pending"
    })[status] || status;
  }

  function statusClass(status) {
    if (status === "exception") return "badge pending";
    return "badge " + status;
  }

  function filteredRows() {
    var q = state.query.trim().toLowerCase();
    return listShipments().filter(function (r) {
      if (state.statusFilter === "exception" && r.status !== "exception") return false;
      else if (state.statusFilter !== "all" && state.statusFilter !== "exception" && r.status !== state.statusFilter) return false;
      if (state.serviceFilter !== "all" && r.serviceType !== state.serviceFilter) return false;
      if (!q) return true;
      var hay = [r.id, r.sender, r.receiver, r.fromLocation, r.toLocation, r.near, r.serviceType, r.packageContent].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function loadChats() {
    try {
      return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveChats(chats) {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chats));
    try {
      if (window.__dsvChatChannel) {
        window.__dsvChatChannel.postMessage({ type: "chats-updated", chats: chats });
      }
    } catch (e) {}
  }

  function ensureSeedChat(chats) {
    if (chats.length) return chats;
    var seeded = [{
      id: "c-welcome",
      name: "Website Visitor",
      unread: 0,
      updatedAt: Date.now(),
      messages: [
        { from: "customer", text: "Hi — can you help me track a package?", at: Date.now() - 60000 }
      ]
    }];
    saveChats(seeded);
    return seeded;
  }

  function setView(view) {
    state.view = view;
    $$(".nav-item").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-view") === view);
    });
    $$(".view").forEach(function (el) {
      el.classList.toggle("is-active", el.id === "view-" + view);
    });
    document.body.classList.remove("nav-open");
    render();
  }

  function renderChart(rows) {
    var m = metrics(rows);
    var delivered = [2, 3, 4, 3, 5, 6, 5, 7, 6, 8, m.delivered + 6, m.delivered + 7];
    var transit = [5, 6, 5, 7, 6, 8, 7, 9, 8, 7, m.onTransit + 4, m.onTransit + 5];
    var w = 640;
    var h = 240;
    var pad = 28;
    var max = Math.max.apply(null, delivered.concat(transit).concat([1]));
    function x(i) { return pad + (i * (w - pad * 2)) / (delivered.length - 1); }
    function y(v) { return h - pad - ((v / max) * (h - pad * 2)); }
    function path(arr) {
      return arr.map(function (v, i) {
        return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
      }).join(" ");
    }
    var area = path(delivered) + " L " + x(delivered.length - 1).toFixed(1) + " " + (h - pad) + " L " + pad + " " + (h - pad) + " Z";
    $("#overview-chart").innerHTML =
      '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
        '<defs><linearGradient id="gDelivered" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1d6feb" stop-opacity=".28"/><stop offset="100%" stop-color="#1d6feb" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#gDelivered)"/>' +
        '<path d="' + path(delivered) + '" fill="none" stroke="#1d6feb" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="' + path(transit) + '" fill="none" stroke="#93c5fd" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="6 6"/>' +
      "</svg>";
  }

  function renderKpis(rows) {
    var m = metrics(rows);
    $("#kpi-total").textContent = String(m.total);
    $("#kpi-transit").textContent = String(m.onTransit);
    $("#kpi-delivered").textContent = String(m.delivered);
    $("#kpi-pending").textContent = String(m.pending);
  }

  function renderLiveCard(rows) {
    var live = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].status === "in-transit" || rows[i].status === "out-for-delivery") {
        live = rows[i];
        break;
      }
    }
    if (!live && rows[0]) live = rows[0];
    if (!live) return;
    state.liveId = live.id;
    $(".live-card__id").textContent = "Shipment #" + live.id.slice(-6);
    $(".live-card__status").textContent = statusLabel(live.status);
    $("#live-route").textContent = cityOnly(live.fromLocation) + " → " + cityOnly(live.toLocation);
    $("#live-eta").textContent = "ETA " + (live.estimatedDelivery !== "—" ? live.estimatedDelivery : "updating…");
  }

  function renderRecent(rows) {
    $("#recent-table").innerHTML = rows.slice(0, 6).map(function (r) {
      return (
        '<tr data-open-id="' + escapeHtml(r.id) + '">' +
          '<td class="mono">' + escapeHtml(r.id) + "</td>" +
          '<td><div class="route"><strong>' + escapeHtml(cityOnly(r.fromLocation)) + " → " + escapeHtml(cityOnly(r.toLocation)) + "</strong><span>" + escapeHtml(r.receiver) + "</span></div></td>" +
          '<td><span class="' + statusClass(r.status) + '">' + escapeHtml(statusLabel(r.status)) + "</span></td>" +
          "<td>" + escapeHtml(r.lastDate || "—") + "</td>" +
        "</tr>"
      );
    }).join("") || '<tr><td colspan="4" class="empty">No shipments</td></tr>';
  }

  function renderFleet(rows) {
    var m = metrics(rows);
    var onRoad = Math.max(8, m.onTransit * 8 + 20);
    var maintenance = Math.max(3, m.pending * 2 + 4);
    var idle = Math.max(2, 8 - Math.min(6, m.delivered));
    var total = onRoad + maintenance + idle;
    var p1 = (onRoad / total) * 100;
    var p2 = ((onRoad + maintenance) / total) * 100;
    var donut = $("#fleet-donut");
    if (donut) {
      donut.style.setProperty("--p1", p1.toFixed(1) + "%");
      donut.style.setProperty("--p2", p2.toFixed(1) + "%");
    }
    $("#fleet-total").textContent = String(total);
    var legend =
      '<div><span><i style="background:#1d6feb"></i>On Road</span><strong>' + onRoad + "</strong></div>" +
      '<div><span><i style="background:#f59e0b"></i>In Maintenance</span><strong>' + maintenance + "</strong></div>" +
      '<div><span><i style="background:#cbd5e1"></i>Idle</span><strong>' + idle + "</strong></div>";
    $("#fleet-legend").innerHTML = legend;
    var page = $("#fleet-page");
    if (page) {
      page.innerHTML =
        '<div class="fleet-wrap"><div class="donut" style="--p1:' + p1.toFixed(1) + "%;--p2:" + p2.toFixed(1) + '%;"><div class="donut__center"><strong>' + total + '</strong><span>Total Trucks</span></div></div></div>' +
        '<div class="fleet-legend">' + legend + "</div>";
    }
    var notes = $("#fleet-notes");
    if (notes) {
      notes.innerHTML =
        '<div class="note-list">' +
          '<div class="note"><div class="note__icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h13v10H3z"/></svg></div><div><strong>' + onRoad + " units on road</strong><span>Covering active transit and OFD lanes</span></div><time>Live</time></div>" +
          '<div class="note"><div class="note__icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></div><div><strong>' + maintenance + " in maintenance</strong><span>Scheduled service & workshop holds</span></div><time>Today</time></div>" +
        "</div>";
    }
  }

  function renderNotifications(rows) {
    var notes = [];
    rows.slice(0, 5).forEach(function (r, i) {
      var kind = r.status === "delivered" ? "green" : r.status === "exception" ? "orange" : "blue";
      var title = r.status === "delivered" ? "Shipment delivered" : r.status === "exception" ? "Delay alert" : "New shipment update";
      notes.push({
        kind: kind,
        title: title,
        text: "#" + r.id.slice(-6) + " · " + cityOnly(r.toLocation),
        when: (i + 1) * 5 + "m ago"
      });
    });
    $("#notif-count").textContent = String(Math.min(9, notes.length || 0));
    $("#notifications").innerHTML = notes.map(function (n) {
      return (
        '<div class="note">' +
          '<div class="note__icon ' + n.kind + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/></svg></div>' +
          "<div><strong>" + escapeHtml(n.title) + "</strong><span>" + escapeHtml(n.text) + "</span></div>" +
          "<time>" + escapeHtml(n.when) + "</time>" +
        "</div>"
      );
    }).join("") || '<p class="empty">No notifications</p>';
  }

  function renderShipmentsTable() {
    var rows = filteredRows();
    $("#shipments-count").textContent = rows.length + " shipments";
    $("#shipments-table").innerHTML = rows.map(function (r) {
      return (
        '<tr data-open-id="' + escapeHtml(r.id) + '">' +
          '<td class="mono">' + escapeHtml(r.id) + "</td>" +
          '<td><span class="' + statusClass(r.status) + '">' + escapeHtml(statusLabel(r.status)) + "</span></td>" +
          "<td>" + escapeHtml(r.serviceType) + "</td>" +
          "<td>" + escapeHtml(r.receiver) + "</td>" +
          "<td>" + escapeHtml(cityOnly(r.fromLocation)) + " → " + escapeHtml(cityOnly(r.toLocation)) + "</td>" +
          "<td>" + escapeHtml(r.near) + "</td>" +
          "<td>" + escapeHtml(r.lastDate || "—") + "</td>" +
        "</tr>"
      );
    }).join("") || '<tr><td colspan="7" class="empty">No matching shipments</td></tr>';
  }

  function renderMoving(rows) {
    var moving = rows.filter(function (r) {
      return r.status === "in-transit" || r.status === "out-for-delivery";
    });
    $("#moving-table").innerHTML = moving.map(function (r) {
      return (
        '<tr data-open-id="' + escapeHtml(r.id) + '">' +
          '<td class="mono">' + escapeHtml(r.id) + "</td>" +
          "<td>" + escapeHtml(r.near) + "</td>" +
          '<td><span class="' + statusClass(r.status) + '">' + escapeHtml(statusLabel(r.status)) + "</span></td>" +
        "</tr>"
      );
    }).join("") || '<tr><td colspan="3" class="empty">No active moves</td></tr>';
  }

  function renderWarehouses(rows) {
    var counts = {};
    rows.forEach(function (r) {
      counts[r.near] = (counts[r.near] || 0) + 1;
    });
    var hubs = Object.keys(counts).map(function (k) {
      return { name: k, count: counts[k] };
    }).sort(function (a, b) { return b.count - a.count; });
    var max = Math.max.apply(null, hubs.map(function (h) { return h.count; }).concat([1]));
    $("#warehouse-list").innerHTML = hubs.map(function (h, i) {
      var pct = Math.round((h.count / max) * 100);
      return (
        '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.85rem 0;border-bottom:1px solid var(--line)">' +
          "<div><strong>" + String(i + 1).padStart(2, "0") + " · " + escapeHtml(h.name) + "</strong><div style=\"color:var(--muted);font-size:.8rem;margin-top:.2rem\">" + h.count + " active touchpoints</div></div>" +
          '<div style="width:140px;height:8px;background:#eef2f7;border-radius:999px;overflow:hidden"><span style="display:block;height:100%;width:' + pct + '%;background:#1d6feb"></span></div>' +
        "</div>"
      );
    }).join("") || '<p class="empty">No hub data</p>';
  }

  function renderReports(rows) {
    var m = metrics(rows);
    $("#report-cards").innerHTML = [
      ["Network volume", m.total + " consignments"],
      ["Active moves", m.onTransit + " on lane"],
      ["Delivered share", (m.total ? Math.round((m.delivered / m.total) * 100) : 0) + "%"],
      ["Pending / exception", m.pending + " need action"]
    ].map(function (item) {
      return '<article class="kpi"><div class="kpi__label">' + escapeHtml(item[0]) + '</div><div class="kpi__value" style="font-size:1.25rem">' + escapeHtml(item[1]) + "</div></article>";
    }).join("");
  }

  function fillServices(rows) {
    var select = $("#filter-service");
    if (!select || select.getAttribute("data-ready") === "1") return;
    var seen = {};
    rows.forEach(function (r) {
      if (seen[r.serviceType]) return;
      seen[r.serviceType] = 1;
      var opt = document.createElement("option");
      opt.value = r.serviceType;
      opt.textContent = r.serviceType;
      select.appendChild(opt);
    });
    select.setAttribute("data-ready", "1");
  }

  function openDrawer(id) {
    var rows = listShipments();
    var row = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) { row = rows[i]; break; }
    if (!row) return;
    $("#drawer").classList.add("is-open");
    $("#drawer-backdrop").classList.add("is-open");
    $("#drawer-title").textContent = id;
    $("#drawer-status").className = statusClass(row.status);
    $("#drawer-status").textContent = statusLabel(row.status);
    $("#drawer-public-link").href = DETAILS_PATH + "?id=" + encodeURIComponent(id);
    $("#drawer-body").innerHTML =
      '<div class="meta-grid">' +
        "<div><span>Service</span><strong>" + escapeHtml(row.serviceType) + "</strong></div>" +
        "<div><span>Near</span><strong>" + escapeHtml(row.near) + "</strong></div>" +
        "<div><span>Sender</span><strong>" + escapeHtml(row.sender) + "</strong></div>" +
        "<div><span>Receiver</span><strong>" + escapeHtml(row.receiver) + "</strong></div>" +
        '<div class="span-2"><span>Origin</span><strong>' + escapeHtml(row.fromLocation) + "</strong></div>" +
        '<div class="span-2"><span>Destination</span><strong>' + escapeHtml(row.toLocation) + "</strong></div>" +
        (row.notice ? '<div class="notice">' + escapeHtml(row.notice) + "</div>" : "") +
      "</div>" +
      '<h3 style="margin:0 0 .7rem;font-size:.95rem">Scan timeline</h3>' +
      '<ol class="timeline">' +
        row.timeline.map(function (ev) {
          return "<li><strong>" + escapeHtml(ev.title) + "</strong><span>" + escapeHtml(ev.location) + "</span><time>" + escapeHtml(ev.date) + "</time></li>";
        }).join("") +
      "</ol>";
  }

  function closeDrawer() {
    $("#drawer").classList.remove("is-open");
    $("#drawer-backdrop").classList.remove("is-open");
  }

  function renderSupport() {
    var chats = ensureSeedChat(loadChats()).slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (!state.selectedChatId && chats[0]) state.selectedChatId = chats[0].id;
    $("#chat-threads").innerHTML = chats.map(function (c) {
      var preview = c.messages && c.messages.length ? c.messages[c.messages.length - 1].text : "No messages";
      return (
        '<button type="button" class="thread' + (c.id === state.selectedChatId ? " is-active" : "") + '" data-chat-id="' + escapeHtml(c.id) + '">' +
          "<strong>" + escapeHtml(c.name || "Visitor") + (c.unread ? " · " + c.unread : "") + "</strong>" +
          "<span>" + escapeHtml(preview) + "</span>" +
        "</button>"
      );
    }).join("") || '<p class="empty">No conversations yet</p>';

    var active = null;
    for (var i = 0; i < chats.length; i++) if (chats[i].id === state.selectedChatId) active = chats[i];
    $("#chat-pane-title").textContent = active ? (active.name || "Visitor") : "Select a conversation";
    $("#chat-msgs").innerHTML = active ? active.messages.map(function (m) {
      return '<div class="bubble ' + (m.from === "agent" ? "agent" : "customer") + '">' + escapeHtml(m.text) + "</div>";
    }).join("") : '<p class="empty">Waiting for customer messages from the homepage widget…</p>';

    if (active && active.unread) {
      active.unread = 0;
      var all = loadChats().map(function (c) {
        return c.id === active.id ? active : c;
      });
      saveChats(all);
    }
    var box = $("#chat-msgs");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function sendAgentReply(text) {
    var cleaned = String(text || "").trim();
    if (!cleaned || !state.selectedChatId) return;
    var chats = loadChats();
    var found = false;
    chats = chats.map(function (c) {
      if (c.id !== state.selectedChatId) return c;
      found = true;
      c.messages = c.messages || [];
      c.messages.push({ from: "agent", text: cleaned, at: Date.now() });
      c.updatedAt = Date.now();
      c.unread = 0;
      return c;
    });
    if (!found) return;
    saveChats(chats);
    renderSupport();
  }

  function render() {
    var rows = listShipments();
    fillServices(rows);
    renderKpis(rows);
    renderChart(rows);
    renderLiveCard(rows);
    renderRecent(rows);
    renderFleet(rows);
    renderNotifications(rows);
    renderShipmentsTable();
    renderMoving(rows);
    renderWarehouses(rows);
    renderReports(rows);
    renderSupport();
    var now = new Date();
    $("#date-range").textContent = "Oct 1 – Oct 31, " + now.getFullYear();
  }

  function unlock() {
    localStorage.setItem(AUTH_KEY, "1");
    document.body.classList.add("is-authenticated");
    setView("dashboard");
  }

  function lock() {
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_KEY);
    document.body.classList.remove("is-authenticated");
    closeDrawer();
  }

  function isAuthed() {
    return localStorage.getItem(AUTH_KEY) === "1" || sessionStorage.getItem(AUTH_KEY) === "1";
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var nav = e.target.closest("[data-view]");
      if (nav && nav.getAttribute("data-view")) {
        setView(nav.getAttribute("data-view"));
        return;
      }
      var open = e.target.closest("[data-open-id]");
      if (open) {
        openDrawer(open.getAttribute("data-open-id"));
        return;
      }
      var chat = e.target.closest("[data-chat-id]");
      if (chat) {
        state.selectedChatId = chat.getAttribute("data-chat-id");
        renderSupport();
        return;
      }
      if (e.target.closest("[data-close-drawer]")) closeDrawer();
    });

    $("#btn-menu") && $("#btn-menu").addEventListener("click", function () {
      document.body.classList.toggle("nav-open");
    });

    $("#global-search").addEventListener("input", function (e) {
      state.query = e.target.value;
      if (state.view !== "shipments") setView("shipments");
      else renderShipmentsTable();
    });

    $("#filter-status").addEventListener("change", function (e) {
      state.statusFilter = e.target.value;
      renderShipmentsTable();
    });
    $("#filter-service").addEventListener("change", function (e) {
      state.serviceFilter = e.target.value;
      renderShipmentsTable();
    });

    $("#live-track-btn").addEventListener("click", function () {
      if (state.liveId) openDrawer(state.liveId);
    });

    $("#chat-compose").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("#chat-input");
      var value = input.value;
      input.value = "";
      sendAgentReply(value);
    });

    $("#login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var user = ($("#login-user").value || "").trim().toLowerCase();
      var pass = ($("#login-pass").value || "").trim();
      var allowedUser =
        user === "admin" ||
        user === "ops" ||
        user === "admin@dsv.com" ||
        user === "admin@dsv.co";
      if (allowedUser && (pass === "dsv2026" || pass === "admin")) {
        $("#login-error").hidden = true;
        if ($("#remember-device") && $("#remember-device").checked) {
          localStorage.setItem(AUTH_KEY, "1");
        } else {
          sessionStorage.setItem(AUTH_KEY, "1");
          localStorage.removeItem(AUTH_KEY);
        }
        document.body.classList.add("is-authenticated");
        setView("dashboard");
      } else {
        $("#login-error").hidden = false;
      }
    });

    var togglePass = $("#toggle-pass");
    if (togglePass) {
      togglePass.addEventListener("click", function () {
        var input = $("#login-pass");
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
      });
    }

    $("#btn-logout").addEventListener("click", function () {
      sessionStorage.removeItem(AUTH_KEY);
      lock();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer();
    });

    window.addEventListener("storage", function (e) {
      if (e.key === CHAT_KEY) renderSupport();
    });

    try {
      window.__dsvChatChannel = new BroadcastChannel(CHAT_CHANNEL);
      window.__dsvChatChannel.onmessage = function () {
        renderSupport();
      };
    } catch (err) {}
  }

  function init() {
    bind();
    if (isAuthed()) {
      document.body.classList.add("is-authenticated");
      setView("dashboard");
    } else {
      render();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

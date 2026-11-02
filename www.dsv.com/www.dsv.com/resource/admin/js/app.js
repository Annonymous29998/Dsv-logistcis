(function () {
  "use strict";

  var NAV = [
    { id: "dashboard", label: "Dashboard" },
    { id: "shipments", label: "Shipments" },
    { id: "tracking", label: "Live Tracking" },
    { id: "customers", label: "Customers" },
    { id: "fleet", label: "Fleet Management" },
    { id: "reports", label: "Reports & Analytics" },
    { id: "support", label: "Help & Support" }
  ];

  var state = {
    user: null,
    view: "dashboard",
    shipments: [],
    query: "",
    filters: { status: "all" },
    selectedChatId: null,
    openChatDrawerId: null,
    openShipment: null
  };

  var root = document.getElementById("view-root");
  var navEl = document.getElementById("side-nav");

  function icon(name) {
    var paths = {
      dashboard: '<path d="M4 10h7V4H4v6zm9 10h7v-6h-7v6zM4 20h7v-6H4v6zm9-10h7V4h-7v6z"/>',
      shipments: '<path d="M3 7h13v10H3z"/><path d="M16 10h4l1 3v4h-5V10z"/>',
      tracking: '<path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
      customers: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
      fleet: '<path d="M3 7h13v10H3z"/><path d="M16 10h4l1 3v4h-5V10z"/>',
      drivers: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
      warehouses: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-8h6v8"/>',
      reports: '<path d="M4 19V5M4 19h16M8 17V9M12 17v-6M16 17V7"/>',
      billing: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>',
      staff: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      notifications: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
      support: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + (paths[name] || paths.dashboard) + "</svg>";
  }

  function renderNav() {
    navEl.innerHTML = NAV.map(function (item) {
      return (
        '<button type="button" class="nav-item' + (state.view === item.id ? " is-active" : "") +
        '" data-nav="' + item.id + '" aria-label="' + AdminUtils.escapeHtml(item.label) + '">' +
        icon(item.id) + "<span>" + AdminUtils.escapeHtml(item.label) + "</span></button>"
      );
    }).join("");
  }

  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", !!collapsed);
    try { localStorage.setItem("dsv-admin-sidebar-collapsed", collapsed ? "1" : "0"); } catch (e) {}
    var btn = document.getElementById("btn-sidebar-toggle");
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    }
  }

  function initSidebarToggle() {
    var collapsed = false;
    try { collapsed = localStorage.getItem("dsv-admin-sidebar-collapsed") === "1"; } catch (e) {}
    setSidebarCollapsed(collapsed);
    var btn = document.getElementById("btn-sidebar-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
  }

  function setView(view) {
    if (view === "notifications") {
      openNotificationsModal();
      return;
    }
    state.view = view || "dashboard";
    if (view === "shipments" && !arguments[1]) {
      // keep filters
    }
    if (state.view !== "support") {
      var chatDrawer = document.getElementById("chat-drawer");
      var chatBackdrop = document.getElementById("chat-drawer-backdrop");
      if (chatDrawer) {
        chatDrawer.classList.remove("is-open");
        chatDrawer.setAttribute("aria-hidden", "true");
      }
      if (chatBackdrop) chatBackdrop.classList.remove("is-open");
    }
    renderNav();
    document.body.classList.remove("nav-open");
    var overlay = document.getElementById("nav-overlay");
    if (overlay) overlay.hidden = true;
    renderView();
  }

  function renderView() {
    var view = window.AdminViews[state.view];
    if (!view || !view.render) {
      root.innerHTML = AdminUtils.backendNote(state.view);
      return;
    }
    view.render(root, state);
  }

  var openDrawerId = null;
  var realtimeTimer = null;

  function renderDrawerActions(row) {
    var actions = document.getElementById("drawer-actions");
    if (!actions || !row) return;
    var status = AdminUtils.normalizeStatus(row.status);
    var html = "";
    if (status !== "cancelled") {
      html += '<button type="button" class="btn" data-shipment-action="edit">Edit details</button>';
    }
    if (status === "on-hold") {
      html += '<button type="button" class="btn" data-shipment-action="release-hold">Release hold</button>';
    } else if (status !== "cancelled" && status !== "delivered") {
      html += '<button type="button" class="btn btn-warn" data-shipment-action="hold">Place on hold</button>';
    }
    if (status !== "cancelled" && status !== "delivered") {
      html += '<button type="button" class="btn btn-danger" data-shipment-action="cancel">Cancel shipment</button>';
    }
    actions.innerHTML = html;
  }

  function openEditShipmentModal(row) {
    if (!row || !row.id) return;
    var existing = document.getElementById("edit-shipment-modal");
    if (existing) existing.remove();

    var status = AdminUtils.normalizeStatus(row.status);
    var statusOptions = [
      ["pending", "Pending / Label created"],
      ["in-transit", "In Transit"],
      ["out-for-delivery", "Out for Delivery"],
      ["delivered", "Delivered"]
    ];
    if (status === "on-hold") {
      statusOptions.unshift(["on-hold", "On Hold (use Release hold)"]);
    }

    var modal = document.createElement("div");
    modal.id = "edit-shipment-modal";
    modal.className = "create-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML =
      '<div class="create-modal__backdrop" data-edit-dismiss="1"></div>' +
      '<div class="create-modal__panel">' +
        '<header class="create-modal__head">' +
          "<div>" +
            "<h2>Edit shipment</h2>" +
            "<p>Update details for <strong class=\"mono\">" + AdminUtils.escapeHtml(row.id) + "</strong>.</p>" +
          "</div>" +
          '<button type="button" class="create-modal__close" data-edit-dismiss="1" aria-label="Close">&times;</button>' +
        "</header>" +
        '<form class="create-form create-modal__form" id="edit-shipment-form">' +
          '<div class="create-modal__body">' +
            '<div class="form-grid">' +
              '<div class="field"><label for="edit-sender">Sender name</label>' +
                '<input id="edit-sender" required value="' + AdminUtils.escapeHtml(row.sender || "") + '"></div>' +
              '<div class="field"><label for="edit-receiver">Receiver name</label>' +
                '<input id="edit-receiver" required value="' + AdminUtils.escapeHtml(row.receiver || "") + '"></div>' +
              (AdminViews.createShipment && AdminViews.createShipment.addressFieldHtml
                ? AdminViews.createShipment.addressFieldHtml("edit-from", "Origin", row.fromLocation || "")
                : '<div class="field address-field"><label for="edit-from">Origin</label><input id="edit-from" required value="' + AdminUtils.escapeHtml(row.fromLocation || "") + '"></div>') +
              (AdminViews.createShipment && AdminViews.createShipment.addressFieldHtml
                ? AdminViews.createShipment.addressFieldHtml("edit-to", "Destination", row.toLocation || "")
                : '<div class="field address-field"><label for="edit-to">Destination</label><input id="edit-to" required value="' + AdminUtils.escapeHtml(row.toLocation || "") + '"></div>') +
              '<div class="field"><label for="edit-service">Service</label>' +
                '<select id="edit-service">' +
                  ["DSV Road", "DSV Air Express", "DSV Ocean", "DSV Rail"].map(function (s) {
                    return '<option' + (row.serviceType === s ? " selected" : "") + ">" + s + "</option>";
                  }).join("") +
                "</select></div>" +
              '<div class="field"><label for="edit-package">Package content</label>' +
                '<input id="edit-package" value="' + AdminUtils.escapeHtml(row.packageContent || "") + '"></div>' +
              '<div class="field"><label for="edit-delivery-time">Delivery window</label>' +
                '<input id="edit-delivery-time" value="' + AdminUtils.escapeHtml(row.deliveryTime || "") + '"></div>' +
              '<div class="field"><label for="edit-eta">Estimated delivery</label>' +
                '<input id="edit-eta" value="' + AdminUtils.escapeHtml(row.estimatedDelivery || "") + '"></div>' +
              '<div class="field"><label for="edit-status">Status</label>' +
                '<select id="edit-status"' + (status === "on-hold" ? " disabled" : "") + ">" +
                  statusOptions.map(function (opt) {
                    return '<option value="' + opt[0] + '"' + (status === opt[0] ? " selected" : "") + ">" + opt[1] + "</option>";
                  }).join("") +
                "</select></div>" +
              '<div class="field field--check"><label><input id="edit-signature" type="checkbox"' +
                (row.signatureRequired !== false ? " checked" : "") + "> Signature required</label></div>" +
            "</div>" +
            '<p class="form-error" id="edit-error" hidden></p>' +
          "</div>" +
          '<footer class="create-modal__foot">' +
            '<button type="button" class="btn" data-edit-dismiss="1">Cancel</button>' +
            '<button type="submit" class="btn btn-primary" id="edit-save">Save changes</button>' +
          "</footer>" +
        "</form>" +
      "</div>";

    document.body.appendChild(modal);
    document.body.classList.add("create-modal-open");

    var geoState = {
      from: {
        label: row.fromLocation || "",
        lat: row.fromLat != null ? Number(row.fromLat) : null,
        lon: row.fromLon != null ? Number(row.fromLon) : null
      },
      to: {
        label: row.toLocation || "",
        lat: row.toLat != null ? Number(row.toLat) : null,
        lon: row.toLon != null ? Number(row.toLon) : null
      }
    };
    if (AdminViews.createShipment && typeof AdminViews.createShipment.bindAddressAutocomplete === "function") {
      AdminViews.createShipment.bindAddressAutocomplete(modal.querySelector("#edit-from"), "from", geoState);
      AdminViews.createShipment.bindAddressAutocomplete(modal.querySelector("#edit-to"), "to", geoState);
    }

    function closeEdit() {
      modal.remove();
      document.body.classList.remove("create-modal-open");
    }

    modal.addEventListener("click", function (event) {
      if (event.target.closest("[data-edit-dismiss]")) {
        event.preventDefault();
        closeEdit();
      }
    });

    modal.querySelector("#edit-shipment-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var errEl = modal.querySelector("#edit-error");
      var btn = modal.querySelector("#edit-save");
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        var payload = {
          action: "edit",
          sender: modal.querySelector("#edit-sender").value.trim(),
          receiver: modal.querySelector("#edit-receiver").value.trim(),
          fromLocation: geoState.from.label || modal.querySelector("#edit-from").value.trim(),
          toLocation: geoState.to.label || modal.querySelector("#edit-to").value.trim(),
          fromLat: geoState.from.lat,
          fromLon: geoState.from.lon,
          toLat: geoState.to.lat,
          toLon: geoState.to.lon,
          serviceType: modal.querySelector("#edit-service").value,
          packageContent: modal.querySelector("#edit-package").value.trim(),
          deliveryTime: modal.querySelector("#edit-delivery-time").value.trim(),
          estimatedDelivery: modal.querySelector("#edit-eta").value.trim(),
          signatureRequired: modal.querySelector("#edit-signature").checked,
          reason: "Details edited in admin drawer"
        };
        if (status !== "on-hold") {
          payload.status = modal.querySelector("#edit-status").value;
        }
        var result = await AdminAPI.updateShipment(row.id, payload);
        mergeShipmentIntoState(result && result.shipment);
        closeEdit();
        renderView();
        openDrawer(row.id);
        AdminUtils.toast({
          title: "Changes saved",
          message: "Tracking " + row.id + " was updated."
        });
        await refreshFromServer({ announce: true, id: row.id, eventType: "*" });
        openDrawer(row.id);
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = (err && err.message) || "Could not save changes.";
        AdminUtils.toast({
          type: "error",
          title: "Save failed",
          message: (err && err.message) || "Could not save changes."
        });
        btn.disabled = false;
        btn.textContent = "Save changes";
      }
    });

    window.setTimeout(function () {
      var first = modal.querySelector("#edit-sender");
      if (first) first.focus();
    }, 40);
  }

  function openDrawer(id) {
    var row = state.shipments.find(function (item) { return item.id === id; });
    if (!row) return;
    openDrawerId = id;
    document.getElementById("drawer").classList.add("is-open");
    document.getElementById("drawer-backdrop").classList.add("is-open");
    document.getElementById("drawer-title").textContent = id;
    var status = document.getElementById("drawer-status");
    status.className = AdminUtils.statusClass(row.status);
    status.textContent = AdminUtils.statusLabel(row.status);
    document.getElementById("drawer-public").href = "/new/tracking/shipment-details-public?id=" + encodeURIComponent(id);
    renderDrawerActions(row);
    var notice = row.deliveryNotice && (row.deliveryNotice.en || row.deliveryNotice);
    var reason = row.holdReason || row.cancelReason || row.statusReason;
    document.getElementById("drawer-body").innerHTML =
      '<div class="meta-grid">' +
        "<div><span>Service</span><strong>" + AdminUtils.escapeHtml(row.serviceType || "—") + "</strong></div>" +
        "<div><span>Near</span><strong>" + AdminUtils.escapeHtml(row.statusNearPlace || AdminUtils.shortPlace(row.lastLocation)) + "</strong></div>" +
        "<div><span>Sender</span><strong>" + AdminUtils.escapeHtml(row.sender || "—") + "</strong></div>" +
        "<div><span>Receiver</span><strong>" + AdminUtils.escapeHtml(row.receiver || "—") + "</strong></div>" +
        '<div class="span-2"><span>Package</span><strong>' + AdminUtils.escapeHtml(row.packageContent || "—") + "</strong></div>" +
        '<div class="span-2"><span>Origin</span><strong>' + AdminUtils.escapeHtml(row.fromLocation || "—") + "</strong></div>" +
        '<div class="span-2"><span>Destination</span><strong>' + AdminUtils.escapeHtml(row.toLocation || "—") + "</strong></div>" +
        (reason ? '<div class="span-2"><span>Status reason</span><strong>' + AdminUtils.escapeHtml(reason) + "</strong></div>" : "") +
        (notice ? '<div class="span-2 backend-note">' + AdminUtils.escapeHtml(notice) + "</div>" : "") +
      "</div>" +
      '<h3 style="margin:0 0 .7rem;font-size:.95rem">Scan timeline</h3>' +
      '<ol class="timeline">' +
        (row.timeline || []).map(function (ev) {
          return "<li><strong>" + AdminUtils.escapeHtml(ev.title) + "</strong><span>" +
            AdminUtils.escapeHtml(ev.location) + "</span><time>" + AdminUtils.escapeHtml(ev.date) + "</time></li>";
        }).join("") +
      "</ol>";
  }

  function askReason(options) {
    options = options || {};
    return new Promise(function (resolve) {
      var existing = document.getElementById("reason-modal");
      if (existing) existing.remove();

      var modal = document.createElement("div");
      modal.id = "reason-modal";
      modal.className = "reason-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.innerHTML =
        '<div class="reason-modal__backdrop" data-reason-cancel="1"></div>' +
        '<div class="reason-modal__panel">' +
          "<h3>" + AdminUtils.escapeHtml(options.title || "Reason") + "</h3>" +
          "<p>" + AdminUtils.escapeHtml(options.message || "") + "</p>" +
          '<label class="reason-modal__label" for="reason-modal-input">' +
            AdminUtils.escapeHtml(options.label || "Reason") +
          "</label>" +
          '<textarea id="reason-modal-input" rows="3" placeholder="' +
            AdminUtils.escapeHtml(options.placeholder || "") + '"></textarea>' +
          '<p class="reason-modal__error" id="reason-modal-error" hidden></p>' +
          '<div class="reason-modal__actions">' +
            '<button type="button" class="btn" data-reason-cancel="1">Cancel</button>' +
            '<button type="button" class="btn ' +
              AdminUtils.escapeHtml(options.confirmClass || "btn-primary") +
              '" id="reason-modal-confirm">' +
              AdminUtils.escapeHtml(options.confirmLabel || "Confirm") +
            "</button>" +
          "</div>" +
        "</div>";
      document.body.appendChild(modal);

      var input = modal.querySelector("#reason-modal-input");
      var error = modal.querySelector("#reason-modal-error");
      var settled = false;

      function finish(value) {
        if (settled) return;
        settled = true;
        modal.remove();
        resolve(value);
      }

      modal.addEventListener("click", function (event) {
        if (event.target.closest("[data-reason-cancel]")) finish(null);
      });
      modal.querySelector("#reason-modal-confirm").addEventListener("click", function () {
        var value = String(input.value || "").trim();
        if (options.required && !value) {
          error.hidden = false;
          error.textContent = options.requiredMessage || "A reason is required.";
          input.focus();
          return;
        }
        finish(value);
      });
      document.addEventListener("keydown", function onKey(event) {
        if (!document.getElementById("reason-modal")) {
          document.removeEventListener("keydown", onKey);
          return;
        }
        if (event.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          finish(null);
        }
      });
      window.setTimeout(function () { input.focus(); }, 30);
    });
  }

  function mergeShipmentIntoState(shipment) {
    if (!shipment || !shipment.id) return null;
    var idx = state.shipments.findIndex(function (item) { return item.id === shipment.id; });
    var next = Object.assign({}, idx >= 0 ? state.shipments[idx] : {}, shipment);
    if (idx >= 0) state.shipments[idx] = next;
    else state.shipments.unshift(next);
    return next;
  }

  async function runShipmentAction(action) {
    if (!openDrawerId) return;
    var id = openDrawerId;
    var reason = "";
    var actions = document.getElementById("drawer-actions");
    var buttons = actions ? Array.prototype.slice.call(actions.querySelectorAll("button")) : [];
    buttons.forEach(function (btn) { btn.disabled = true; });
    var successToast = null;
    try {
      if (action === "edit") {
        var row = state.shipments.find(function (item) { return item.id === id; });
        if (!row) return;
        openEditShipmentModal(row);
        return;
      } else if (action === "hold") {
        reason = await askReason({
          title: "Place shipment on hold",
          message: "This reason is shown on public tracking.",
          label: "Hold reason",
          placeholder: "e.g. Awaiting customs clearance documents",
          confirmLabel: "Place on hold",
          confirmClass: "btn-warn",
          required: true,
          requiredMessage: "A hold reason is required."
        });
        if (reason == null) return;
        var holdResult = await AdminAPI.holdShipment(id, reason);
        mergeShipmentIntoState(holdResult && holdResult.shipment);
        successToast = {
          title: "Shipment on hold",
          message: "Tracking " + id + " is now on hold."
        };
      } else if (action === "release-hold") {
        reason = await askReason({
          title: "Release hold",
          message: "Optional note for the tracking timeline.",
          label: "Release note (optional)",
          placeholder: "e.g. Documents received, resuming transit",
          confirmLabel: "Release hold",
          required: false
        });
        if (reason == null) return;
        var releaseResult = await AdminAPI.releaseHold(id, String(reason).trim());
        mergeShipmentIntoState(releaseResult && releaseResult.shipment);
        successToast = {
          title: "Hold released",
          message: "Tracking " + id + " is moving again."
        };
      } else if (action === "cancel") {
        reason = await askReason({
          title: "Cancel shipment",
          message: "This reason is shown on public tracking.",
          label: "Cancel reason",
          placeholder: "e.g. Customer requested cancellation",
          confirmLabel: "Cancel shipment",
          confirmClass: "btn-danger",
          required: true,
          requiredMessage: "A cancel reason is required."
        });
        if (reason == null) return;
        var cancelResult = await AdminAPI.cancelShipment(id, reason);
        mergeShipmentIntoState(cancelResult && cancelResult.shipment);
        successToast = {
          title: "Shipment cancelled",
          message: "Tracking " + id + " was cancelled."
        };
      } else {
        return;
      }
      renderView();
      if (openDrawerId === id) openDrawer(id);
      if (successToast) AdminUtils.toast(successToast);
      await refreshFromServer({ announce: true, id: id, eventType: "*" });
      if (openDrawerId === id) openDrawer(id);
    } catch (err) {
      AdminUtils.toast({
        type: "error",
        title: "Action failed",
        message: (err && err.message) || "Could not update this shipment."
      });
    } finally {
      buttons.forEach(function (btn) { btn.disabled = false; });
      if (openDrawerId === id) {
        var latest = state.shipments.find(function (item) { return item.id === id; });
        if (latest) renderDrawerActions(latest);
      }
    }
  }

  function closeDrawer() {
    openDrawerId = null;
    document.getElementById("drawer").classList.remove("is-open");
    document.getElementById("drawer-backdrop").classList.remove("is-open");
  }

  function announceShipmentChange(id, eventType) {
    if (window.DsvRealtime && window.DsvRealtime.publishLocal) {
      window.DsvRealtime.publishLocal({ id: id || null, eventType: eventType || "*" });
    }
  }

  async function refreshFromServer(options) {
    options = options || {};
    try {
      var data = await AdminAPI.shipments();
      state.shipments = data.shipments || [];
      renderView();
      if (openDrawerId) {
        var still = state.shipments.some(function (row) { return row.id === openDrawerId; });
        if (still) openDrawer(openDrawerId);
        else closeDrawer();
      }
      if (options.announce) announceShipmentChange(options.id, options.eventType);
      document.body.classList.add("is-live-updated");
      setTimeout(function () { document.body.classList.remove("is-live-updated"); }, 900);
    } catch (err) {
      if (options.announce && AdminUtils.toast) {
        AdminUtils.toast({
          type: "error",
          title: "Refresh failed",
          message: (err && err.message) || "Could not reload shipments from the server."
        });
      }
    }
  }

  function initRealtime() {
    if (!window.DsvRealtime || !window.DsvRealtime.subscribeShipments) return;
    window.DsvRealtime.subscribeShipments({
      onChange: function () {
        if (realtimeTimer) clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(function () { refreshFromServer(); }, 150);
      }
    });
  }

  async function clearAllShipmentData() {
    var count = (state.shipments || []).length;
    if (!count) {
      AdminUtils.toast({
        type: "warn",
        title: "Nothing to clear",
        message: "The shipment book is already empty."
      });
      return false;
    }
    var confirmed = await AdminUtils.confirmDangerZone({
      title: "Danger zone",
      message:
        "Clear all shipment data from the live book. Public tracking links will stop working until you create new shipments.",
      detail: [
        count + " shipment" + (count === 1 ? "" : "s") + " will be deleted forever",
        "Hold, cancel, and timeline history will be removed",
        "This cannot be undone"
      ],
      confirmLabel: "Yes",
      cancelLabel: "No"
    });
    if (!confirmed) return false;

    try {
      var result = await AdminAPI.clearAllShipments();
      state.shipments = [];
      closeDrawer();
      renderView();
      announceShipmentChange(null, "DELETE");
      AdminUtils.toast({
        title: "All data cleared",
        message:
          "Removed " +
          Number((result && result.deleted) || count) +
          " shipment" +
          (count === 1 ? "" : "s") +
          " from the book."
      });
      await refreshFromServer({ announce: false });
      return true;
    } catch (err) {
      AdminUtils.toast({
        type: "error",
        title: "Clear failed",
        message: (err && err.message) || "Could not clear shipment data."
      });
      return false;
    }
  }

  state.refreshFromServer = refreshFromServer;
  state.announceShipmentChange = announceShipmentChange;
  state.clearAllShipmentData = clearAllShipmentData;

  var NOTIF_CLEARED_KEY = "dsv-admin-notif-cleared-at";
  var lastChatUnreadTotal = 0;
  state.supportChats = state.supportChats || [];

  function setSupportChats(chats) {
    state.supportChats = Array.isArray(chats) ? chats : [];
  }

  function loadSupportChats() {
    return state.supportChats || [];
  }

  function getNotifClearedAt() {
    try { return String(localStorage.getItem(NOTIF_CLEARED_KEY) || ""); }
    catch (e) { return ""; }
  }

  function chatUnreadTotal() {
    return loadSupportChats().reduce(function (sum, chat) {
      return sum + (Number(chat.unread) || 0);
    }, 0);
  }

  function buildNotificationItems() {
    var clearedAt = getNotifClearedAt();
    var chats = loadSupportChats();
    var chatNotes = chats
      .filter(function (c) {
        var unread = Number(c.unread) || 0;
        if (unread > 0) return true;
        if (!(c.messages && c.messages.length)) return false;
        if (!clearedAt) return true;
        return Number(c.updatedAt || 0) > Date.parse(clearedAt);
      })
      .sort(function (a, b) {
        return (Number(b.unread) || 0) - (Number(a.unread) || 0) ||
          Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      })
      .slice(0, 8)
      .map(function (c) {
        var last = c.messages && c.messages.length ? c.messages[c.messages.length - 1] : null;
        var unread = Number(c.unread) || 0;
        return {
          kind: "chat",
          chatId: c.id,
          title: unread
            ? ("New customer message" + (unread > 1 ? "s (" + unread + ")" : ""))
            : "Support conversation",
          text: (c.name || "Visitor") + (last && last.text ? " · " + last.text : ""),
          when: c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "—",
          unread: unread
        };
      });

    var shipNotes = clearedAt
      ? []
      : (state.shipments || []).slice(0, 6).map(function (row) {
        var status = AdminUtils.normalizeStatus(row.status);
        var title = status === "exception" || status === "on-hold"
          ? "Needs attention"
          : status === "delivered"
            ? "Delivered"
            : "Shipment update";
        return {
          kind: "shipment",
          id: row.id,
          title: title,
          text: "#" + String(row.id).slice(-6) + " · " + AdminUtils.cityOnly(row.toLocation),
          when: row.lastDate || "—",
          unread: 0
        };
      });

    return chatNotes.concat(shipNotes);
  }

  function notificationsHeadCopy() {
    var unread = chatUnreadTotal();
    return unread
      ? (unread + " unread customer message" + (unread === 1 ? "" : "s"))
      : "Customer chat and shipment updates";
  }

  async function clearAllNotifications() {
    var chats = loadSupportChats();
    for (var i = 0; i < chats.length; i++) {
      if ((chats[i].unread || 0) > 0) {
        try { await AdminAPI.supportAction({ id: chats[i].id, action: "read" }); } catch (e) {}
      }
    }
    try {
      var data = await AdminAPI.supportChats();
      setSupportChats((data && data.chats) || []);
    } catch (e) {}
    try { localStorage.setItem(NOTIF_CLEARED_KEY, new Date().toISOString()); }
    catch (e) {}
    lastChatUnreadTotal = 0;
    updateChatNotifications({ silent: true, skipViewRefresh: false });
    var sub = document.getElementById("notif-modal-sub");
    if (sub) sub.textContent = notificationsHeadCopy();
    refreshNotificationsModal();
  }

  function notificationsListHtml() {
    var notes = buildNotificationItems();
    if (!notes.length) {
      return '<p class="empty">No notifications yet.</p>';
    }
    return notes.map(function (n) {
      if (n.kind === "chat") {
        return (
          '<button type="button" class="note notif-modal__item' + (n.unread ? " is-unread" : "") +
          '" data-notif-chat="' + AdminUtils.escapeHtml(n.chatId) + '">' +
            '<div class="kpi__icon blue" style="width:2rem;height:2rem">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            "</div>" +
            "<div><strong>" + AdminUtils.escapeHtml(n.title) + "</strong>" +
            "<span>" + AdminUtils.escapeHtml(n.text) + "</span></div>" +
            "<time>" + AdminUtils.escapeHtml(n.when) + "</time>" +
          "</button>"
        );
      }
      return (
        '<button type="button" class="note notif-modal__item" data-notif-shipment="' +
          AdminUtils.escapeHtml(n.id) + '">' +
          '<div class="kpi__icon blue" style="width:2rem;height:2rem">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' +
          "</div>" +
          "<div><strong>" + AdminUtils.escapeHtml(n.title) + "</strong>" +
          "<span>" + AdminUtils.escapeHtml(n.text) + "</span></div>" +
          "<time>" + AdminUtils.escapeHtml(n.when) + "</time>" +
        "</button>"
      );
    }).join("");
  }

  function closeNotificationsModal() {
    var modal = document.getElementById("notif-modal");
    if (modal) modal.remove();
    document.body.classList.remove("notif-modal-open");
    var bell = document.getElementById("btn-notifications");
    if (bell) bell.setAttribute("aria-expanded", "false");
  }

  function refreshNotificationsModal() {
    var list = document.getElementById("notif-modal-list");
    if (!list) return;
    list.innerHTML = notificationsListHtml();
  }

  function openNotificationsModal() {
    closeNotificationsModal();
    var modal = document.createElement("div");
    modal.id = "notif-modal";
    modal.className = "notif-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "notif-modal-title");
    modal.innerHTML =
      '<div class="notif-modal__backdrop" data-notif-close="1"></div>' +
      '<div class="notif-modal__panel">' +
        '<div class="notif-modal__head">' +
          "<div>" +
            '<h2 id="notif-modal-title">Notifications</h2>' +
            '<p id="notif-modal-sub">' + AdminUtils.escapeHtml(notificationsHeadCopy()) + "</p>" +
            '<button type="button" class="notif-modal__clear" data-notif-clear="1">Clear all</button>' +
          "</div>" +
          '<button type="button" class="notif-modal__close" data-notif-close="1" aria-label="Close notifications">×</button>' +
        "</div>" +
        '<div class="notif-modal__list note-list" id="notif-modal-list">' +
          notificationsListHtml() +
        "</div>" +
      "</div>";

    document.body.appendChild(modal);
    document.body.classList.add("notif-modal-open");
    var bell = document.getElementById("btn-notifications");
    if (bell) bell.setAttribute("aria-expanded", "true");

    modal.addEventListener("click", function (event) {
      if (event.target.closest("[data-notif-clear]")) {
        event.preventDefault();
        clearAllNotifications();
        return;
      }
      if (event.target.closest("[data-notif-close]")) {
        closeNotificationsModal();
        return;
      }
      var chatBtn = event.target.closest("[data-notif-chat]");
      if (chatBtn) {
        state.selectedChatId = chatBtn.getAttribute("data-notif-chat");
        state.openChatDrawerId = state.selectedChatId;
        closeNotificationsModal();
        setView("support");
        return;
      }
      var shipBtn = event.target.closest("[data-notif-shipment]");
      if (shipBtn) {
        closeNotificationsModal();
        openDrawer(shipBtn.getAttribute("data-notif-shipment"));
      }
    });

    function onKey(event) {
      if (event.key === "Escape") {
        closeNotificationsModal();
        document.removeEventListener("keydown", onKey);
      }
    }
    document.addEventListener("keydown", onKey);
  }

  function playAdminNotifySound() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 740;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      osc.stop(ctx.currentTime + 0.3);
      window.setTimeout(function () { try { ctx.close(); } catch (e) {} }, 450);
    } catch (e) {}
  }

  async function refreshSupportChatsFromApi() {
    try {
      var data = await AdminAPI.supportChats();
      setSupportChats((data && data.chats) || []);
    } catch (e) {
      if (e && e.status === 401) {
        stopPolling();
        return;
      }
      /* keep cache on transient errors */
    }
  }

  function updateChatNotifications(options) {
    options = options || {};
    var total = chatUnreadTotal();
    var badge = document.getElementById("notif-count");
    var bell = document.getElementById("btn-notifications");
    if (badge) {
      badge.textContent = total > 9 ? "9+" : String(total);
      badge.classList.toggle("is-on", total > 0);
      badge.setAttribute("aria-hidden", total > 0 ? "false" : "true");
    }
    if (bell) {
      bell.setAttribute(
        "aria-label",
        total > 0 ? ("Notifications, " + total + " unread customer message" + (total === 1 ? "" : "s")) : "Notifications"
      );
    }
    if (!options.silent && total > lastChatUnreadTotal) {
      playAdminNotifySound();
    }
    lastChatUnreadTotal = total;
    if (!options.skipViewRefresh && state.view === "support") {
      renderView();
    }
    if (document.getElementById("notif-modal")) {
      refreshNotificationsModal();
    }
  }

  var supportPollTimer = null;

  function stopPolling() {
    if (supportPollTimer) {
      window.clearInterval(supportPollTimer);
      supportPollTimer = null;
    }
  }

  function initChatNotifications() {
    stopPolling();
    refreshSupportChatsFromApi().then(function () {
      lastChatUnreadTotal = chatUnreadTotal();
      updateChatNotifications({ silent: true, skipViewRefresh: true });
    });
    supportPollTimer = window.setInterval(function () {
      refreshSupportChatsFromApi().then(function () {
        var total = chatUnreadTotal();
        if (total !== lastChatUnreadTotal) updateChatNotifications();
        else updateChatNotifications({ silent: true, skipViewRefresh: true });
      }).catch(function () {});
    }, 2000);
  }

  state.updateChatNotifications = updateChatNotifications;
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.updateChatNotifications = updateChatNotifications;
  window.AdminApp.setSupportChats = setSupportChats;
  window.AdminApp.stopPolling = stopPolling;

  function bind() {
    document.addEventListener("click", function (event) {
      var nav = event.target.closest("[data-nav]");
      if (nav) {
        var chatId = nav.getAttribute("data-chat-id");
        if (chatId) state.selectedChatId = chatId;
        setView(nav.getAttribute("data-nav"));
        return;
      }
      var open = event.target.closest("[data-open-id]");
      if (open) {
        openDrawer(open.getAttribute("data-open-id"));
      }
    });

    var notifBtn = document.getElementById("btn-notifications");
    if (notifBtn) {
      notifBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openNotificationsModal();
      });
    }

    document.getElementById("btn-menu").addEventListener("click", function () {
      document.body.classList.toggle("nav-open");
      document.getElementById("nav-overlay").hidden = !document.body.classList.contains("nav-open");
    });
    document.getElementById("nav-overlay").addEventListener("click", function () {
      document.body.classList.remove("nav-open");
      document.getElementById("nav-overlay").hidden = true;
    });
    document.getElementById("drawer-close").addEventListener("click", closeDrawer);
    document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
    document.getElementById("drawer-actions").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-shipment-action]");
      if (!btn) return;
      runShipmentAction(btn.getAttribute("data-shipment-action"));
    });
    document.getElementById("global-search").addEventListener("input", function (event) {
      state.query = event.target.value || "";
      if (state.view !== "shipments") setView("shipments");
      else renderView();
    });
    async function doLogout() {
      stopPolling();
      try { await AdminAPI.logout(); } catch (e) {}
      window.location.replace("/admin/login");
    }

    var userMenu = document.getElementById("user-menu");
    var userMenuBtn = document.getElementById("user-menu-btn");
    var userMenuDropdown = document.getElementById("user-menu-dropdown");

    function closeUserMenu() {
      if (!userMenu || !userMenuBtn || !userMenuDropdown) return;
      userMenu.classList.remove("is-open");
      userMenuBtn.setAttribute("aria-expanded", "false");
      userMenuDropdown.hidden = true;
    }

    function toggleUserMenu() {
      if (!userMenu || !userMenuBtn || !userMenuDropdown) return;
      var open = userMenuDropdown.hidden;
      if (open) {
        userMenu.classList.add("is-open");
        userMenuBtn.setAttribute("aria-expanded", "true");
        userMenuDropdown.hidden = false;
      } else {
        closeUserMenu();
      }
    }

    if (userMenuBtn) {
      userMenuBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        toggleUserMenu();
      });
    }
    document.getElementById("btn-logout-menu").addEventListener("click", function (event) {
      event.stopPropagation();
      closeUserMenu();
      doLogout();
    });
    document.getElementById("btn-logout").addEventListener("click", doLogout);
    document.addEventListener("click", function (event) {
      if (userMenu && !userMenu.contains(event.target)) closeUserMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeUserMenu();
        closeDrawer();
      }
    });
  }

  async function boot() {
    try {
      var me = await AdminAPI.me();
      if (!me || !me.authenticated) {
        window.location.replace("/admin/login");
        return;
      }
      state.user = me.user;
      document.getElementById("admin-name").textContent = "Admin User";
      document.getElementById("admin-role").textContent = "Administrator";
    } catch (err) {
      window.location.replace("/admin/login");
      return;
    }

    try {
      var data = await AdminAPI.shipments();
      state.shipments = data.shipments || [];
    } catch (err) {
      state.shipments = [];
      root.innerHTML = '<div class="backend-note"><strong>Unable to load shipments.</strong><br>' +
        AdminUtils.escapeHtml(err.message || "API error") + "</div>";
      return;
    }

    state.openShipment = openDrawer;
    bind();
    initSidebarToggle();
    setView("dashboard");
    initRealtime();
    initChatNotifications();
  }

  boot();
})();

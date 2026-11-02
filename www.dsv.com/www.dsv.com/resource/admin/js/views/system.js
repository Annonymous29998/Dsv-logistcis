(function (global) {
  "use strict";
  function U() { return global.AdminUtils; }

  function reportsView(root, ctx) {
    var summary = U().summarize(ctx.shipments);
    root.innerHTML =
      '<div class="welcome"><div><h1>Reports & Analytics</h1><p>Performance based on the live tracking book.</p></div>' +
      '<button type="button" class="btn" id="export-csv">Export CSV</button></div>' +
      '<div class="kpi-row">' +
        '<article class="kpi"><div class="kpi__label">Delivery share</div><div class="kpi__value">' +
          (summary.total ? Math.round((summary.delivered / summary.total) * 100) : 0) + "%</div></article>" +
        '<article class="kpi"><div class="kpi__label">Active share</div><div class="kpi__value">' +
          (summary.total ? Math.round((summary.active / summary.total) * 100) : 0) + "%</div></article>" +
        '<article class="kpi"><div class="kpi__label">Exception share</div><div class="kpi__value">' +
          (summary.total ? Math.round((summary.exception / summary.total) * 100) : 0) + "%</div></article>" +
        '<article class="kpi"><div class="kpi__label">Revenue report</div><div class="kpi__value">—</div><div class="kpi__trend">Billing API required</div></article>' +
      "</div>" +
      U().backendNote("PDF export / historical revenue / driver scorecards");

    var btn = document.getElementById("export-csv");
    if (btn) {
      btn.addEventListener("click", function () {
        var lines = [["id", "status", "receiver", "from", "to", "service", "lastDate"].join(",")];
        ctx.shipments.forEach(function (row) {
          lines.push([
            row.id,
            row.status,
            JSON.stringify(row.receiver || ""),
            JSON.stringify(row.fromLocation || ""),
            JSON.stringify(row.toLocation || ""),
            JSON.stringify(row.serviceType || ""),
            JSON.stringify(row.lastDate || "")
          ].join(","));
        });
        var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "dsv-shipments-export.csv";
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  function billingView(root) {
    root.innerHTML =
      '<div class="welcome"><div><h1>Billing & Invoices</h1><p>Invoice and payment operations.</p></div></div>' +
      U().backendNote("Invoices, outstanding balances, payment records, and PDF generation");
  }

  function staffView(root) {
    root.innerHTML =
      '<div class="welcome"><div><h1>Staff Management</h1><p>Administrator and operator accounts.</p></div></div>' +
      U().backendNote("Staff CRUD, roles, and permission management") +
      '<article class="card" style="margin-top:1rem"><div class="card__body">' +
        "<p style=\"margin:0 0 .5rem\"><strong>Current session role:</strong> administrator</p>" +
        "<p style=\"margin:0;color:var(--muted)\">Only server-authenticated administrators can open this application.</p>" +
      "</div></article>";
  }

  async function notificationsView(root, ctx) {
    var chats = [];
    try {
      var data = await global.AdminAPI.supportChats();
      chats = (data && data.chats) || [];
    } catch (e) {
      chats = [];
    }
    var chatNotes = chats
      .filter(function (c) { return (c.unread || 0) > 0 || (c.messages && c.messages.length); })
      .slice(0, 10)
      .map(function (c) {
        var last = c.messages && c.messages.length ? c.messages[c.messages.length - 1] : null;
        var unread = c.unread || 0;
        return {
          kind: "chat",
          chatId: c.id,
          title: unread ? ("New customer message" + (unread > 1 ? "s (" + unread + ")" : "")) : "Support conversation",
          text: (c.name || "Visitor") + (last ? " · " + last.text : ""),
          when: c.updatedAt ? new Date(c.updatedAt).toLocaleTimeString() : "—"
        };
      });
    var shipNotes = (ctx.shipments || []).slice(0, 8).map(function (row, i) {
      return {
        kind: "shipment",
        id: row.id,
        title: U().normalizeStatus(row.status) === "exception" ? "Delay alert" : "Shipment update",
        text: "#" + String(row.id).slice(-6) + " · " + U().cityOnly(row.toLocation),
        when: (i + 1) * 3 + "m ago"
      };
    });
    var notes = chatNotes.concat(shipNotes);
    root.innerHTML =
      '<div class="welcome"><div><h1>Notifications</h1><p>Live customer chat alerts and shipment updates.</p></div></div>' +
      '<article class="card"><div class="card__body"><div class="note-list">' +
      (notes.length ? notes.map(function (n) {
        if (n.kind === "chat") {
          return '<button type="button" class="note" style="width:100%;cursor:pointer" data-nav="support" data-chat-id="' +
            U().escapeHtml(n.chatId) + '"><div class="kpi__icon blue" style="width:2rem;height:2rem"></div><div><strong>' +
            U().escapeHtml(n.title) + "</strong><span>" + U().escapeHtml(n.text) + "</span></div><time>" +
            U().escapeHtml(n.when) + "</time></button>";
        }
        return '<button type="button" class="note" style="width:100%;cursor:pointer" data-open-id="' + U().escapeHtml(n.id) + '">' +
          '<div class="kpi__icon blue" style="width:2rem;height:2rem"></div><div><strong>' + U().escapeHtml(n.title) +
          "</strong><span>" + U().escapeHtml(n.text) + "</span></div><time>" + U().escapeHtml(n.when) + "</time></button>";
      }).join("") : '<p class="empty">No notifications yet.</p>') +
      "</div></div></article>";
  }

  function settingsView(root, ctx) {
    root.innerHTML =
      '<div class="welcome"><div><h1>Settings</h1><p>Control room preferences for this environment.</p></div></div>' +
      '<div class="grid-2">' +
        '<article class="card"><div class="card__head"><h2>Company</h2></div><div class="card__body">' +
          "<p><strong>Brand:</strong> DSV Logistics Solutions</p>" +
          "<p><strong>Public site:</strong> <a href=\"/\" target=\"_blank\" rel=\"noopener\">Open homepage</a></p>" +
          "<p style=\"color:var(--muted)\">Company profile editing requires a settings API.</p>" +
        "</div></article>" +
        '<article class="card"><div class="card__head"><h2>Security</h2></div><div class="card__body">' +
          "<p><strong>Signed in as:</strong> " + U().escapeHtml((ctx.user && ctx.user.email) || "—") + "</p>" +
          "<p><strong>Session:</strong> HttpOnly server cookie</p>" +
          "<p style=\"color:var(--muted)\">Passwords are verified with PBKDF2 on the server. Credentials are loaded from environment variables.</p>" +
        "</div></article>" +
      "</div>";
  }

  var supportCache = [];
  var typingIdleTimer = null;
  var typingPulseTimer = null;
  var typingActiveChatId = null;

  function loadSupportChats() {
    return supportCache.slice();
  }

  async function fetchSupportChats() {
    try {
      var data = await global.AdminAPI.supportChats();
      supportCache = (data && data.chats) || [];
    } catch (e) {
      supportCache = supportCache || [];
    }
    if (typeof window.AdminApp !== "undefined" && typeof window.AdminApp.setSupportChats === "function") {
      window.AdminApp.setSupportChats(supportCache);
    }
    return supportCache.slice();
  }

  function notifySupportChanged() {
    if (typeof window.AdminApp !== "undefined" && typeof window.AdminApp.updateChatNotifications === "function") {
      window.AdminApp.updateChatNotifications({ silent: true, skipViewRefresh: true });
    }
  }

  function publishAgentTyping(chatId, typing) {
    if (!chatId || !global.AdminAPI || !global.AdminAPI.supportAction) return;
    global.AdminAPI.supportAction({ id: chatId, action: "typing", typing: !!typing }).catch(function () {});
  }

  function signalAgentTyping(chatId) {
    typingActiveChatId = chatId;
    // Pulse at most every 2.5s while typing so we don't stampede the API.
    if (!typingPulseTimer) {
      publishAgentTyping(chatId, true);
      typingPulseTimer = window.setInterval(function () {
        if (!typingActiveChatId) return;
        publishAgentTyping(typingActiveChatId, true);
      }, 2500);
    }
    if (typingIdleTimer) clearTimeout(typingIdleTimer);
    typingIdleTimer = window.setTimeout(function () {
      clearAgentTyping(chatId);
    }, 4500);
  }

  function clearAgentTyping(chatId) {
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
    if (typingPulseTimer) {
      clearInterval(typingPulseTimer);
      typingPulseTimer = null;
    }
    typingActiveChatId = null;
    publishAgentTyping(chatId, false);
  }

  async function markChatRead(chatId) {
    if (!chatId) return loadSupportChats();
    try {
      await global.AdminAPI.supportAction({ id: chatId, action: "read" });
    } catch (e) {}
    return fetchSupportChats();
  }

  function bubbleClass(from) {
    if (from === "agent") return "agent";
    if (from === "bot") return "bot";
    return "customer";
  }

  function closeChatDrawer() {
    var drawer = document.getElementById("chat-drawer");
    var backdrop = document.getElementById("chat-drawer-backdrop");
    if (drawer) {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
    }
    if (backdrop) backdrop.classList.remove("is-open");
  }

  function chatGeoLabel(chat) {
    if (!chat) return "";
    var parts = [];
    if (chat.ip) parts.push(chat.ip);
    if (chat.country || chat.city || chat.geoLabel) {
      parts.push(chat.geoLabel || [chat.city, chat.country].filter(Boolean).join(", "));
    }
    return parts.filter(Boolean).join(" · ");
  }

  function fillChatDrawer(chat) {
    var title = document.getElementById("chat-drawer-title");
    var sub = document.getElementById("chat-drawer-sub");
    var msgs = document.getElementById("chat-drawer-msgs");
    var endBtn = document.getElementById("chat-drawer-end");
    var form = document.getElementById("chat-drawer-form");
    if (!chat || !msgs) return;
    if (title) title.textContent = chat.name || "Visitor";
    if (sub) {
      var count = (chat.messages || []).length;
      var geo = chatGeoLabel(chat);
      sub.textContent = count + " message" + (count === 1 ? "" : "s") +
        (geo ? " · " + geo : " · locating visitor…") +
        (chat.status === "ended" ? " · ended" : "");
    }
    var nextHtml = (chat.messages || []).map(function (m) {
      if (m.from === "system") {
        return '<div class="bubble bot">' + U().escapeHtml(m.text) + "</div>";
      }
      return '<div class="bubble ' + bubbleClass(m.from) + '">' + U().escapeHtml(m.text) + "</div>";
    }).join("") || '<p class="empty">No messages in this conversation yet.</p>';
    // Avoid wiping the transcript DOM (and scroll) when nothing changed.
    if (msgs.getAttribute("data-msg-sig") !== String((chat.messages || []).length) + ":" + nextHtml.length) {
      msgs.innerHTML = nextHtml;
      msgs.setAttribute("data-msg-sig", String((chat.messages || []).length) + ":" + nextHtml.length);
      msgs.scrollTop = msgs.scrollHeight;
    }
    var ended = chat.status === "ended";
    if (endBtn) {
      endBtn.disabled = ended;
      endBtn.textContent = ended ? "Conversation ended" : "End conversation";
    }
    if (form) {
      var input = document.getElementById("chat-drawer-input");
      var sendBtn = form.querySelector('button[type="submit"]');
      if (input) input.disabled = ended;
      if (sendBtn) sendBtn.disabled = ended;
    }
  }

  async function openChatDrawer(chatId, ctx) {
    if (!chatId) return;
    ctx.selectedChatId = chatId;
    try {
      await global.AdminAPI.supportAction({ id: chatId, action: "open" });
      await global.AdminAPI.supportAction({ id: chatId, action: "read" });
    } catch (e) {}
    var chats = await fetchSupportChats();
    notifySupportChanged();
    var chat = chats.find(function (c) { return c.id === chatId; });
    if (!chat) return;

    var shipDrawer = document.getElementById("drawer");
    var shipBackdrop = document.getElementById("drawer-backdrop");
    if (shipDrawer) shipDrawer.classList.remove("is-open");
    if (shipBackdrop) shipBackdrop.classList.remove("is-open");

    fillChatDrawer(chat);
    var drawer = document.getElementById("chat-drawer");
    var backdrop = document.getElementById("chat-drawer-backdrop");
    if (drawer) {
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
    }
    if (backdrop) backdrop.classList.add("is-open");

    var input = document.getElementById("chat-drawer-input");
    if (input) window.setTimeout(function () { input.focus(); }, 180);
  }

  function bindChatDrawerOnce(ctx) {
    if (bindChatDrawerOnce.done) return;
    bindChatDrawerOnce.done = true;

    var closeBtn = document.getElementById("chat-drawer-close");
    var backdrop = document.getElementById("chat-drawer-backdrop");
    var form = document.getElementById("chat-drawer-form");

    function onClose() {
      closeChatDrawer();
    }
    if (closeBtn) closeBtn.addEventListener("click", onClose);
    if (backdrop) backdrop.addEventListener("click", onClose);

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var drawer = document.getElementById("chat-drawer");
      if (drawer && drawer.classList.contains("is-open")) closeChatDrawer();
    });

    var endBtn = document.getElementById("chat-drawer-end");
    if (endBtn) {
      endBtn.addEventListener("click", async function () {
        if (!ctx.selectedChatId) return;
        if (!window.confirm("End this conversation? The visitor will see that the chat ended and can open a new conversation.")) {
          return;
        }
        clearAgentTyping(ctx.selectedChatId);
        try {
          await global.AdminAPI.supportAction({ id: ctx.selectedChatId, action: "end" });
        } catch (e) {}
        var chats = await fetchSupportChats();
        notifySupportChanged();
        var chat = chats.find(function (c) { return c.id === ctx.selectedChatId; });
        fillChatDrawer(chat);
        var root = document.getElementById("view-root");
        if (root && ctx.view === "support") supportView(root, ctx);
      });
    }

    var input = document.getElementById("chat-drawer-input");
    if (input) {
      input.addEventListener("input", function () {
        if (!ctx.selectedChatId) return;
        var value = String(input.value || "").trim();
        if (!value) {
          clearAgentTyping(ctx.selectedChatId);
          return;
        }
        signalAgentTyping(ctx.selectedChatId);
      });
      input.addEventListener("blur", function () {
        if (ctx.selectedChatId) clearAgentTyping(ctx.selectedChatId);
      });
    }

    if (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var replyInput = document.getElementById("chat-drawer-input");
        var text = (replyInput && replyInput.value || "").trim();
        if (!text || !ctx.selectedChatId) return;
        clearAgentTyping(ctx.selectedChatId);
        try {
          await global.AdminAPI.supportAction({ id: ctx.selectedChatId, action: "message", text: text });
        } catch (e) {}
        if (replyInput) replyInput.value = "";
        var chats = await fetchSupportChats();
        notifySupportChanged();
        var chat = chats.find(function (c) { return c.id === ctx.selectedChatId; });
        fillChatDrawer(chat);
        var root = document.getElementById("view-root");
        if (root && ctx.view === "support") supportView(root, ctx);
      });
    }
  }

  async function clearAllConversations(ctx) {
    var current = await fetchSupportChats();
    if (!current.length) return false;
    if (!window.confirm("Clear all conversations? This removes every support chat for all visitors.")) {
      return false;
    }
    clearAgentTyping(ctx && ctx.selectedChatId);
    try {
      await global.AdminAPI.supportClearAll();
    } catch (e) {
      try { await global.AdminAPI.supportAction({ action: "clear-all" }); } catch (err) {}
    }
    supportCache = [];
    if (ctx) {
      ctx.selectedChatId = null;
      ctx.openChatDrawerId = null;
    }
    closeChatDrawer();
    notifySupportChanged();
    return true;
  }

  async function supportView(root, ctx) {
    bindChatDrawerOnce(ctx);
    var chats = await fetchSupportChats();
    chats = chats.slice().sort(function (a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

    var openCount = chats.filter(function (c) { return c.status !== "ended"; }).length;
    root.innerHTML =
      '<div class="welcome"><div><h1>Help & Support</h1><p>Click a conversation to open it. IP and country help you tell visitors apart. End a chat when you are done so it clears on the visitor widget.</p></div>' +
        (chats.length
          ? '<button type="button" class="btn" id="btn-clear-all-chats">Clear all</button>'
          : "") +
      "</div>" +
      '<article class="chat-inbox">' +
        '<div class="chat-inbox__head"><strong>Conversations</strong><span>' + openCount + " open · " + chats.length + " total</span></div>" +
        '<div class="chat-threads" id="chat-threads">' +
          chats.map(function (c) {
            var preview = c.messages && c.messages.length ? c.messages[c.messages.length - 1].text : "No messages";
            var unread = c.status === "ended" ? 0 : (c.unread || 0);
            var when = c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "";
            var geo = chatGeoLabel(c);
            return '<button type="button" class="thread' +
              (c.id === ctx.selectedChatId ? " is-active" : "") +
              (c.status === "ended" ? " is-ended" : "") +
              '" data-open-chat="' + U().escapeHtml(c.id) + '">' +
              "<strong>" + U().escapeHtml(c.name || "Visitor") + "</strong>" +
              (unread ? '<span class="thread__unread">' + (unread > 9 ? "9+" : unread) + "</span>" : "") +
              "<span>" + U().escapeHtml(preview) + "</span>" +
              (geo ? '<span class="thread__geo">' + U().escapeHtml(geo) + "</span>" : "") +
              (when ? '<span class="thread__meta">' + U().escapeHtml(when) + "</span>" : "") +
              "</button>";
          }).join("") +
          (chats.length ? "" : '<p class="empty" style="padding:1rem">No conversations yet. Messages from the homepage widget will appear here.</p>') +
        "</div></article>";

    var clearBtn = document.getElementById("btn-clear-all-chats");
    if (clearBtn) {
      clearBtn.addEventListener("click", async function () {
        if (await clearAllConversations(ctx)) supportView(root, ctx);
      });
    }

    root.querySelectorAll("[data-open-chat]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openChatDrawer(btn.getAttribute("data-open-chat"), ctx);
        root.querySelectorAll(".thread").forEach(function (el) { el.classList.remove("is-active"); });
        btn.classList.add("is-active");
      });
    });

    var drawer = document.getElementById("chat-drawer");
    if (drawer && drawer.classList.contains("is-open") && ctx.selectedChatId) {
      var live = chats.find(function (c) { return c.id === ctx.selectedChatId; });
      if (live) fillChatDrawer(live);
    }

    if (ctx.openChatDrawerId) {
      var openId = ctx.openChatDrawerId;
      ctx.openChatDrawerId = null;
      if (chats.some(function (c) { return c.id === openId; })) {
        openChatDrawer(openId, ctx);
      }
    }
  }

  function helpView(root, ctx) {
    supportView(root, ctx);
  }

  global.AdminViews = global.AdminViews || {};
  global.AdminViews.reports = { render: reportsView };
  global.AdminViews.billing = { render: billingView };
  global.AdminViews.staff = { render: staffView };
  global.AdminViews.notifications = { render: notificationsView };
  global.AdminViews.settings = { render: settingsView };
  global.AdminViews.support = { render: helpView };
})(window);

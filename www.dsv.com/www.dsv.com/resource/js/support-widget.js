(function () {
  "use strict";

  var dialog = document.getElementById("dialog-id-stage-chatbot");
  if (!dialog) return;

  var shell = dialog.querySelector(".dsv-support-chat");
  var messages = document.getElementById("dsv-chat-messages");
  var statusNote = document.getElementById("dsv-chat-status");
  var endedPanel = document.getElementById("dsv-chat-ended");
  var newChatBtn = document.getElementById("dsv-chat-new");
  var form = document.getElementById("dsv-chat-form");
  var input = document.getElementById("dsv-chat-input");
  var nameInput = document.getElementById("dsv-chat-name");
  var chips = document.getElementById("dsv-chat-chips");
  var body = dialog.querySelector(".dsv-support-chat__body");
  var fab = document.querySelector(".dsv-support-fab");
  var unreadBadge = document.getElementById("dsv-chat-unread");
  var chatSubtitle = document.getElementById("dsv-chat-subtitle");

  var SESSION_KEY = "dsv-support-session-id";
  var activeThread = null;
  var renderedCount = -1;
  var lastSeenAgentCount = 0;
  var notifyAudioCtx = null;
  var visitorGeo = null;
  var conversationEndedLocally = false;
  var endedSoundPlayed = false;
  var isBotTyping = false;
  var isAgentTyping = false;
  var agentTypingClearTimer = null;
  var replyTimer = null;
  var pollBusy = false;

  var LIVE_SUPPORT_REPLY =
    "Thanks — your message was sent to our live support desk. An agent will reply soon.";
  var AGENT_CONNECTED_REPLY = "An agent has been connected.";

  var answers = [
    { keys: ["track a shipment", "how do i track", "track"], text: "Enter your tracking, booking or consignment number in the Track form on this page, then tap Track. You’ll open a live status page with scans and ETA." },
    { keys: ["where do i enter", "enter my tracking", "tracking number"], text: "Use the “Track your shipment” box near the top of the homepage. Paste your ID and press Track." },
    { keys: ["what number", "which number", "booking", "consignment"], text: "You can use a tracking number, booking number or consignment number — whichever appears on your shipping documents or confirmation email." },
    { keys: ["delayed", "delay", "late"], text: "Delays often happen at hubs, customs or weather holds. Open your shipment details page to see the latest scan and any status notes. An agent can also follow up here." },
    { keys: ["delivery updates", "out for delivery", "updates"], text: "Status updates post when parcels are scanned at pickup, hubs and out-for-delivery. Refresh the details page anytime for the latest event." },
    { keys: ["proof of delivery", "pod", "delivered"], text: "When delivery completes, proof of delivery (POD) appears on the shipment details page so you can confirm arrival." },
    { keys: ["hello", "hi", "hey"], text: "Hi — ask about tracking, delays or delivery updates, or tap a suggested question above. A live agent can also reply here." }
  ];

  function apiUrl(id) {
    return "/api/support/" + encodeURIComponent(id);
  }

  async function apiGet(id) {
    var res = await fetch(apiUrl(id), { credentials: "same-origin", cache: "no-store" });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) throw new Error((data && data.error) || "Support lookup failed");
    return data.chat || null;
  }

  async function apiPost(id, body) {
    var res = await fetch(apiUrl(id), {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) throw new Error((data && data.error) || "Support update failed");
    return data.chat || null;
  }

  function sessionId(forceNew) {
    if (forceNew) {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    }
    var id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!id) {
      id = "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(SESSION_KEY, id); } catch (e) {}
    }
    return id;
  }

  function visitorName() {
    var name = nameInput && nameInput.value.trim();
    return name || "Website Visitor";
  }

  function geoPayload() {
    if (!visitorGeo) return {};
    return {
      ip: visitorGeo.ip || "",
      city: visitorGeo.city || "",
      country: visitorGeo.country || "",
      countryCode: visitorGeo.countryCode || "",
      geoLabel: visitorGeo.label || ""
    };
  }

  function supportIsTyping() {
    return isBotTyping || isAgentTyping;
  }

  function appendTypingIndicator() {
    if (!messages) return;
    if (messages.querySelector(".dsv-support-chat__msg--typing")) return;
    var el = document.createElement("div");
    el.className = "dsv-support-chat__msg dsv-support-chat__msg--bot dsv-support-chat__msg--typing";
    el.setAttribute("aria-label", "Support is typing");
    el.innerHTML =
      '<span class="dsv-support-chat__typing-dot"></span>' +
      '<span class="dsv-support-chat__typing-dot"></span>' +
      '<span class="dsv-support-chat__typing-dot"></span>';
    messages.appendChild(el);
    if (body) body.scrollTop = body.scrollHeight;
  }

  function clearTypingIndicator() {
    if (!messages) return;
    var existing = messages.querySelector(".dsv-support-chat__msg--typing");
    if (existing) existing.remove();
  }

  function refreshTypingBubble() {
    if (supportIsTyping()) appendTypingIndicator();
    else clearTypingIndicator();
  }

  function setAgentTyping(on) {
    if (agentTypingClearTimer) {
      clearTimeout(agentTypingClearTimer);
      agentTypingClearTimer = null;
    }
    isAgentTyping = !!on;
    refreshTypingBubble();
    if (isAgentTyping) {
      agentTypingClearTimer = window.setTimeout(function () {
        isAgentTyping = false;
        refreshTypingBubble();
      }, 4000);
    }
  }

  function updateVisitorSubtitle(thread) {
    if (!chatSubtitle) return;
    if (conversationEndedLocally || (thread && thread.status === "ended")) {
      chatSubtitle.textContent = "Conversation ended · start a new chat anytime";
      return;
    }
    chatSubtitle.textContent = visitorGeo ? "Connected · live support" : "Instant answers, 24/7";
  }

  function countAgentMessages(list) {
    var n = 0;
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i].from === "agent") n += 1;
    }
    return n;
  }

  function isLiveSupportAck(text) {
    return String(text || "").toLowerCase().indexOf("your message was sent to our live support desk") !== -1;
  }

  function updateUnreadBadge(count) {
    if (!unreadBadge) return;
    var n = Math.max(0, Number(count) || 0);
    if (n <= 0) {
      unreadBadge.textContent = "0";
      unreadBadge.classList.remove("is-on");
      unreadBadge.setAttribute("aria-hidden", "true");
      if (fab) fab.setAttribute("aria-label", "Open DSV Support chat");
      return;
    }
    unreadBadge.textContent = n > 9 ? "9+" : String(n);
    unreadBadge.classList.add("is-on");
    unreadBadge.setAttribute("aria-hidden", "false");
    if (fab) fab.setAttribute("aria-label", "Open DSV Support chat, " + n + " unread message" + (n === 1 ? "" : "s"));
  }

  function unlockNotifyAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
      if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume();
    } catch (e) {}
  }

  function playNotifySound() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      unlockNotifyAudio();
      var ctx = notifyAudioCtx || new Ctx();
      notifyAudioCtx = ctx;
      if (ctx.state === "suspended") ctx.resume();
      function tone(freq, start, dur, vol) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = vol;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.stop(ctx.currentTime + start + dur + 0.02);
      }
      tone(880, 0, 0.16, 0.05);
      tone(1175, 0.14, 0.22, 0.04);
    } catch (e) {}
  }

  function showChatStatus(text) {
    if (!statusNote) return;
    statusNote.hidden = false;
    statusNote.textContent = text || "";
    if (body) body.scrollTop = body.scrollHeight;
  }

  function hideLiveSupportStatus() {
    if (!statusNote) return;
    statusNote.hidden = true;
    statusNote.textContent = "";
  }

  function syncCenterStatus(thread) {
    if (!thread || thread.status === "ended") {
      hideLiveSupportStatus();
      return;
    }
    if (thread.agentConnected) {
      if (countAgentMessages(thread.messages || []) > 0) hideLiveSupportStatus();
      else showChatStatus(AGENT_CONNECTED_REPLY);
      return;
    }
    if (thread.awaitingAgent) {
      showChatStatus(LIVE_SUPPORT_REPLY);
      return;
    }
    hideLiveSupportStatus();
  }

  function setEndedUi(on) {
    conversationEndedLocally = !!on;
    if (shell) shell.classList.toggle("is-ended", !!on);
    if (endedPanel) {
      if (on) endedPanel.removeAttribute("hidden");
      else endedPanel.setAttribute("hidden", "");
    }
  }

  function renderMessageList(list) {
    if (!messages) return;
    messages.innerHTML = "";
    (list || []).forEach(function (m) {
      if (m.from === "bot" && isLiveSupportAck(m.text)) return;
      var el = document.createElement("div");
      var who = (m.from === "agent" || m.from === "bot" || m.from === "system") ? "bot" : "user";
      el.className = "dsv-support-chat__msg dsv-support-chat__msg--" + who;
      el.textContent = m.from === "agent" ? ("Support: " + m.text) : m.text;
      messages.appendChild(el);
    });
    renderedCount = (list || []).length;
    if (body) body.scrollTop = body.scrollHeight;
  }

  function isChatOpen() {
    return !!(dialog.open || dialog.hasAttribute("open"));
  }

  function applyThread(thread, force) {
    activeThread = thread || null;
    if (!thread) {
      updateUnreadBadge(0);
      updateVisitorSubtitle(null);
      setEndedUi(false);
      return;
    }

    if (thread.status === "ended") {
      if (!endedSoundPlayed) {
        endedSoundPlayed = true;
        playNotifySound();
      }
      updateUnreadBadge(0);
      updateVisitorSubtitle(thread);
      hideLiveSupportStatus();
      setEndedUi(true);
      renderMessageList(thread.messages || []);
      setAgentTyping(false);
      return;
    }

    setEndedUi(false);
    updateVisitorSubtitle(thread);
    var list = thread.messages || [];
    var agentCount = countAgentMessages(list);
    if (agentCount > lastSeenAgentCount) {
      playNotifySound();
      hideLiveSupportStatus();
      setAgentTyping(false);
    }
    lastSeenAgentCount = agentCount;

    if (thread.typing) setAgentTyping(true);
    else if (!isBotTyping) setAgentTyping(false);

    if (isChatOpen()) {
      if ((thread.unreadCustomer || thread.customerUnread || 0) > 0) {
        apiPost(thread.id, { action: "read" }).catch(function () {});
        thread.unreadCustomer = 0;
        thread.customerUnread = 0;
      }
      updateUnreadBadge(0);
    } else {
      updateUnreadBadge(thread.unreadCustomer || thread.customerUnread || 0);
    }

    syncCenterStatus(thread);
    if (!force && list.length === renderedCount) {
      refreshTypingBubble();
      return;
    }
    renderMessageList(list);
    syncCenterStatus(thread);
    refreshTypingBubble();
  }

  async function refreshFromServer(force) {
    var id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!id) return;
    if (pollBusy) return;
    pollBusy = true;
    try {
      var chat = await apiGet(id);
      applyThread(chat, !!force);
    } catch (e) {
      /* keep last known */
    } finally {
      pollBusy = false;
    }
  }

  async function detectVisitorGeo() {
    try {
      var res = await fetch("/api/client-info", { credentials: "same-origin", cache: "no-store" });
      var data = await res.json();
      if (!data || !data.ok) return null;
      visitorGeo = {
        ip: data.ip || "",
        city: data.city || "",
        country: data.country || "",
        countryCode: data.countryCode || "",
        label: data.label || ""
      };
      updateVisitorSubtitle(activeThread);
      var id = null;
      try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
      if (id) {
        await apiPost(id, Object.assign({ action: "meta", name: visitorName() }, geoPayload()));
      }
      return visitorGeo;
    } catch (e) {
      return null;
    }
  }

  function faqReplyFor(text) {
    var q = (text || "").toLowerCase();
    for (var i = 0; i < answers.length; i++) {
      for (var k = 0; k < answers[i].keys.length; k++) {
        if (q.indexOf(answers[i].keys[k]) !== -1) return answers[i].text;
      }
    }
    return null;
  }

  async function startNewConversation() {
    sessionId(true);
    conversationEndedLocally = false;
    endedSoundPlayed = false;
    lastSeenAgentCount = 0;
    renderedCount = -1;
    activeThread = null;
    setEndedUi(false);
    hideLiveSupportStatus();
    if (messages) messages.innerHTML = "";
    updateUnreadBadge(0);
    updateVisitorSubtitle(null);
    await detectVisitorGeo();
    if (input) {
      try { input.focus(); } catch (e) {}
    }
  }

  function openChat() {
    unlockNotifyAudio();
    detectVisitorGeo();
    refreshFromServer(true);
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeChat() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  async function ask(text, options) {
    options = options || {};
    if (options === false) options = { autoReply: false };
    else if (options === true) options = { faq: true };

    var cleaned = (text || "").trim();
    if (!cleaned) return;
    if (activeThread && activeThread.status === "ended") {
      setEndedUi(true);
      return;
    }

    conversationEndedLocally = false;
    var id = sessionId();
    var payload = Object.assign(
      {
        action: "message",
        from: "customer",
        text: cleaned,
        name: visitorName(),
        awaitingAgent: !options.faq
      },
      geoPayload()
    );

    try {
      var chat = await apiPost(id, payload);
      applyThread(chat, true);
    } catch (e) {
      showChatStatus("Could not reach support. Check your connection and try again.");
      return;
    }

    if (options.autoReply === false) return;

    if (!options.faq) {
      if (replyTimer) {
        clearTimeout(replyTimer);
        replyTimer = null;
      }
      isBotTyping = false;
      refreshTypingBubble();
      showChatStatus(LIVE_SUPPORT_REPLY);
      return;
    }

    var auto = faqReplyFor(cleaned);
    if (!auto) {
      try {
        var escalated = await apiPost(id, Object.assign({ action: "meta", awaitingAgent: true, name: visitorName() }, geoPayload()));
        applyThread(escalated, true);
      } catch (e) {}
      showChatStatus(LIVE_SUPPORT_REPLY);
      return;
    }

    hideLiveSupportStatus();
    if (replyTimer) clearTimeout(replyTimer);
    isBotTyping = true;
    appendTypingIndicator();
    var delay = 320 + Math.min(700, Math.round(auto.length * 10));
    replyTimer = window.setTimeout(async function () {
      isBotTyping = false;
      refreshTypingBubble();
      try {
        var withBot = await apiPost(id, {
          action: "message",
          from: "bot",
          text: auto,
          name: visitorName(),
          awaitingAgent: false
        });
        applyThread(withBot, true);
      } catch (e) {}
      replyTimer = null;
    }, delay);
  }

  document.querySelectorAll(".js-dsv-chat-open, .stage-chatbot__btn[data-dialog-id='dialog-id-stage-chatbot']").forEach(function (btn) {
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      unlockNotifyAudio();
      openChat();
    }, true);
  });

  document.querySelectorAll(".js-dsv-chat-close").forEach(function (btn) {
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      closeChat();
    });
  });

  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) closeChat();
  });

  if (chips) {
    chips.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-q]");
      if (!chip) return;
      ask(chip.getAttribute("data-q"), { faq: true });
    });
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input ? input.value : "";
      if (input) input.value = "";
      ask(value, { faq: false });
    });
  }

  if (nameInput) {
    nameInput.addEventListener("change", function () {
      var id = null;
      try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
      if (!id) return;
      apiPost(id, Object.assign({ action: "meta", name: visitorName() }, geoPayload())).then(function (chat) {
        applyThread(chat, false);
      }).catch(function () {});
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", function () {
      startNewConversation();
    });
  }

  (function restore() {
    var id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!id) {
      updateUnreadBadge(0);
      updateVisitorSubtitle(null);
      setEndedUi(false);
      detectVisitorGeo();
      return;
    }
    refreshFromServer(true).then(function () {
      detectVisitorGeo();
    });
  })();

  window.setInterval(function () {
    var id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!id && !conversationEndedLocally) return;
    refreshFromServer(false);
  }, 2000);
})();

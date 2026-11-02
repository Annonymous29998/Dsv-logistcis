(function (global) {
  "use strict";

  var CHANNEL_NAME = "dsv-shipments-live";
  var configPromise = null;
  var clientPromise = null;
  var bus = null;
  var busListeners = [];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  function fetchConfig() {
    if (configPromise) return configPromise;
    configPromise = fetch("/api/public/config", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.realtime || !data.supabaseUrl || !data.supabaseAnonKey) return null;
        return data;
      })
      .catch(function () { return null; });
    return configPromise;
  }

  function getClient() {
    if (clientPromise) return clientPromise;
    clientPromise = fetchConfig().then(function (cfg) {
      if (!cfg) return null;
      var createClient = global.supabase && global.supabase.createClient;
      var ready = createClient
        ? Promise.resolve()
        : loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js");
      return ready.then(function () {
        var factory = global.supabase && global.supabase.createClient;
        if (!factory) return null;
        return factory(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      });
    });
    return clientPromise;
  }

  function ensureBus() {
    if (bus || typeof BroadcastChannel === "undefined") return bus;
    try {
      bus = new BroadcastChannel(CHANNEL_NAME);
      bus.onmessage = function (event) {
        var data = event && event.data;
        if (!data || data.type !== "shipment-change") return;
        busListeners.slice().forEach(function (fn) {
          try { fn(data); } catch (e) {}
        });
      };
    } catch (e) {
      bus = null;
    }
    return bus;
  }

  function publishLocal(change) {
    ensureBus();
    if (!bus) return;
    try {
      bus.postMessage({
        type: "shipment-change",
        eventType: change.eventType || "*",
        id: change.id || null,
        at: Date.now()
      });
    } catch (e) {}
  }

  /**
   * Subscribe to shipment changes across every open site tab.
   * Uses Supabase Realtime (cross-visitor) + BroadcastChannel (same browser).
   * @param {object} options
   * @param {string} [options.id] specific tracking id (public page)
   * @param {function} options.onChange callback({ eventType, id })
   * @returns {Promise<function>} unsubscribe
   */
  function subscribeShipments(options) {
    options = options || {};
    var onChange = options.onChange || function () {};
    var trackingId = options.id ? String(options.id) : null;
    var closed = false;
    var removeChannel = null;

    function emit(payload) {
      if (closed) return;
      var id = payload.id || trackingId;
      if (trackingId && id && String(id).toUpperCase() !== trackingId.toUpperCase()) return;
      onChange({
        eventType: payload.eventType || "*",
        id: id,
        raw: payload.raw || payload
      });
    }

    ensureBus();
    var onBus = function (data) { emit(data); };
    busListeners.push(onBus);

    getClient().then(function (client) {
      if (closed || !client) return;

      var filter = trackingId ? "id=eq." + trackingId : undefined;
      var channelName = "shipments-" + (trackingId || "all") + "-" + Math.random().toString(36).slice(2, 8);
      var channel = client
        .channel(channelName)
        .on(
          "postgres_changes",
          Object.assign(
            {
              event: "*",
              schema: "public",
              table: "shipments"
            },
            filter ? { filter: filter } : {}
          ),
          function (payload) {
            var row = payload.new || payload.old || {};
            emit({
              eventType: payload.eventType,
              id: row.id || trackingId,
              raw: payload
            });
          }
        )
        .subscribe();

      removeChannel = function () {
        try { client.removeChannel(channel); } catch (e) {}
      };
    });

    return Promise.resolve(function unsubscribe() {
      closed = true;
      busListeners = busListeners.filter(function (fn) { return fn !== onBus; });
      if (typeof removeChannel === "function") removeChannel();
    });
  }

  global.DsvRealtime = {
    fetchConfig: fetchConfig,
    getClient: getClient,
    subscribeShipments: subscribeShipments,
    publishLocal: publishLocal
  };
})(window);

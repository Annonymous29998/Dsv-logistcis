(function (global) {
  "use strict";

  async function request(path, options) {
    options = options || {};
    var response = await fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: Object.assign(
        { Accept: "application/json" },
        options.body ? { "Content-Type": "application/json" } : {},
        options.headers || {}
      ),
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }

    if (!response.ok) {
      var error = new Error((data && data.error) || ("Request failed (" + response.status + ")"));
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  global.AdminAPI = {
    me: function () { return request("/api/admin/me"); },
    login: function (email, password, remember) {
      return request("/api/admin/login", {
        method: "POST",
        body: { email: email, password: password, remember: !!remember }
      });
    },
    logout: function () {
      return request("/api/admin/logout", { method: "POST", body: {} });
    },
    shipments: function () { return request("/api/admin/shipments"); },
    summary: function () { return request("/api/admin/summary"); },
    searchAddress: function (q) {
      return request("/api/admin/geo/search?q=" + encodeURIComponent(q || ""));
    },
    previewRoute: function (body) {
      return request("/api/admin/shipments/preview-route", { method: "POST", body: body });
    },
    createShipment: function (body) {
      return request("/api/admin/shipments", { method: "POST", body: body });
    },
    getShipment: function (id) {
      return request("/api/admin/shipments/" + encodeURIComponent(id));
    },
    updateShipment: function (id, body) {
      return request("/api/admin/shipments/" + encodeURIComponent(id), {
        method: "PATCH",
        body: Object.assign({ action: "edit" }, body || {})
      });
    },
    holdShipment: function (id, reason) {
      return request("/api/admin/shipments/" + encodeURIComponent(id), {
        method: "PATCH",
        body: { action: "hold", reason: reason }
      });
    },
    releaseHold: function (id, note) {
      return request("/api/admin/shipments/" + encodeURIComponent(id), {
        method: "PATCH",
        body: { action: "release-hold", note: note }
      });
    },
    cancelShipment: function (id, reason) {
      return request("/api/admin/shipments/" + encodeURIComponent(id), {
        method: "PATCH",
        body: { action: "cancel", reason: reason }
      });
    },
    deleteShipment: function (id) {
      return request("/api/admin/shipments/" + encodeURIComponent(id), {
        method: "DELETE"
      });
    },
    supportChats: function () {
      return request("/api/admin/support");
    },
    supportAction: function (body) {
      return request("/api/admin/support", { method: "POST", body: body || {} });
    },
    supportClearAll: function () {
      return request("/api/admin/support", { method: "DELETE" });
    }
  };
})(window);

(function (global) {
  "use strict";

  function U() { return global.AdminUtils; }

  function field(name, label, attrs) {
    attrs = attrs || "";
    return (
      '<div class="field">' +
        '<label for="' + name + '">' + label + "</label>" +
        '<input id="' + name + '" name="' + name + '" ' + attrs + ">" +
      "</div>"
    );
  }

  function pinSvg() {
    return '<svg class="address-suggest__pin" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>';
  }

  function spinnerSvg() {
    return '<svg class="address-suggest__spinner" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  }

  function addressField(name, label, value) {
    var val = value ? ' value="' + U().escapeHtml(value) + '"' : "";
    return (
      '<div class="field address-field" data-address-field="' + name + '">' +
        '<label for="' + name + '">' + label + "</label>" +
        '<div class="address-control">' +
          '<input id="' + name + '" name="' + name + '" autocomplete="off" spellcheck="false"' +
            ' role="combobox" aria-autocomplete="list" aria-expanded="false"' +
            ' placeholder="Any country — start typing a street, city, or place…"' + val + ">" +
          '<div class="address-suggest" role="listbox" hidden></div>' +
        "</div>" +
        '<p class="field-hint" data-geo-hint="' + name + '" hidden></p>' +
      "</div>"
    );
  }

  function normalizeRows(rows) {
    return (rows || []).map(function (row) {
      var label = String(row.label || row.display_name || "").trim();
      return {
        label: label,
        primary: String(row.primary || row.name || label.split(",")[0] || "").trim(),
        secondary: String(row.secondary || label).trim(),
        lat: Number(row.lat),
        lon: Number(row.lon),
        type: row.type || ""
      };
    }).filter(function (row) {
      return row.label && !Number.isNaN(row.lat) && !Number.isNaN(row.lon);
    });
  }

  async function lookupAddresses(q) {
    // Prefer authenticated admin proxy; fall back to the same Nominatim call PBG uses.
    try {
      if (global.AdminAPI && typeof global.AdminAPI.searchAddress === "function") {
        var data = await global.AdminAPI.searchAddress(q);
        var proxied = normalizeRows(data && data.results);
        if (proxied.length) return proxied;
      }
    } catch (_err) {
      /* fall through */
    }
    // Worldwide — no countrycodes filter (unlike PBG's US-only mode).
    var params = new URLSearchParams({
      q: q,
      format: "jsonv2",
      addressdetails: "1",
      limit: "8"
    });
    var res = await fetch("https://nominatim.openstreetmap.org/search?" + params.toString(), {
      headers: { Accept: "application/json", "Accept-Language": "en" }
    });
    if (!res.ok) throw new Error("lookup failed");
    var raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return normalizeRows(raw.map(function (row) {
      var label = String(row.display_name || "").trim();
      var addr = row.address || {};
      var house = String(addr.house_number || "").trim();
      var road = String(addr.road || addr.pedestrian || "").trim();
      var primary = String(row.name || "").trim() || (road ? (house ? house + " " + road : road) : label.split(",")[0]);
      var secondary = label;
      if (primary && label.toLowerCase().indexOf(primary.toLowerCase()) === 0) {
        secondary = label.slice(primary.length).replace(/^[\s,]+/, "") || label;
      }
      return {
        label: label,
        primary: primary,
        secondary: secondary,
        lat: row.lat,
        lon: row.lon,
        type: row.type || row.category || ""
      };
    }));
  }

  function bindAddressAutocomplete(input, stateKey, state) {
    var wrap = input.closest(".address-field");
    if (!wrap) return;
    var box = wrap.querySelector(".address-suggest");
    var hint = wrap.querySelector("[data-geo-hint]");
    var control = wrap.querySelector(".address-control") || wrap;
    var timer = null;
    var req = 0;
    var active = -1;
    var currentResults = [];
    var picking = false;

    if (!state[stateKey]) {
      state[stateKey] = { label: input.value || "", lat: null, lon: null };
    }

    function setExpanded(open) {
      input.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function setBusy(busy) {
      wrap.classList.toggle("is-searching", !!busy);
      var existing = control.querySelector(".address-suggest__spinner");
      if (busy && !existing) {
        control.insertAdjacentHTML("beforeend", spinnerSvg());
      } else if (!busy && existing) {
        existing.remove();
      }
    }

    function clearGeo() {
      state[stateKey] = { label: input.value, lat: null, lon: null };
      wrap.classList.remove("is-mapped");
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
      }
    }

    function choose(row) {
      if (!row) return;
      picking = true;
      input.value = row.label;
      state[stateKey] = { label: row.label, lat: row.lat, lon: row.lon };
      wrap.classList.add("is-mapped");
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Mapped · " + row.lat.toFixed(5) + ", " + row.lon.toFixed(5);
      }
      box.hidden = true;
      setExpanded(false);
      active = -1;
      currentResults = [];
      window.setTimeout(function () { picking = false; }, 0);
    }

    function setActive(next) {
      var items = box.querySelectorAll(".address-suggest__item");
      if (!items.length) return;
      active = (next + items.length) % items.length;
      items.forEach(function (el, i) {
        el.classList.toggle("is-active", i === active);
      });
      if (items[active]) items[active].scrollIntoView({ block: "nearest" });
    }

    function render(results, statusText) {
      currentResults = results || [];
      active = -1;
      if (statusText) {
        box.hidden = false;
        setExpanded(true);
        box.innerHTML = '<div class="address-suggest__status">' + U().escapeHtml(statusText) + "</div>";
        return;
      }
      if (!currentResults.length) {
        box.hidden = true;
        setExpanded(false);
        box.innerHTML = "";
        return;
      }
      box.hidden = false;
      setExpanded(true);
      box.innerHTML = currentResults.map(function (row, i) {
        var primary = row.primary || row.label.split(",")[0];
        var secondary = row.secondary && row.secondary !== row.label ? row.secondary : "";
        if (!secondary && row.label.indexOf(",") !== -1) {
          secondary = row.label.slice(row.label.indexOf(",") + 1).replace(/^[\s,]+/, "");
        }
        return (
          '<button type="button" class="address-suggest__item" role="option" data-idx="' + i + '">' +
            pinSvg() +
            '<span class="address-suggest__text">' +
              '<span class="address-suggest__label">' + U().escapeHtml(primary) + "</span>" +
              (secondary
                ? '<span class="address-suggest__sub">' + U().escapeHtml(secondary) + "</span>"
                : "") +
            "</span>" +
          "</button>"
        );
      }).join("");
      box.querySelectorAll("[data-idx]").forEach(function (btn) {
        btn.addEventListener("mousedown", function (event) {
          event.preventDefault();
          choose(currentResults[Number(btn.getAttribute("data-idx"))]);
        });
      });
    }

    input.addEventListener("input", function () {
      if (picking) return;
      clearGeo();
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 2) {
        setBusy(false);
        box.hidden = true;
        setExpanded(false);
        box.innerHTML = "";
        currentResults = [];
        return;
      }
      setBusy(true);
      timer = setTimeout(async function () {
        var my = ++req;
        try {
          var rows = await lookupAddresses(q);
          if (my !== req) return;
          setBusy(false);
          if (!rows.length) render([], "No addresses found. Try a fuller street, city, or place name.");
          else render(rows);
        } catch (err) {
          if (my !== req) return;
          setBusy(false);
          render([], "Address lookup unavailable. Check your connection and try again.");
        }
      }, 220);
    });

    input.addEventListener("keydown", function (event) {
      if (box.hidden) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(active + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(active - 1);
      } else if (event.key === "Enter" && active >= 0) {
        event.preventDefault();
        choose(currentResults[active]);
      } else if (event.key === "Escape") {
        box.hidden = true;
        setExpanded(false);
      }
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        box.hidden = true;
        setExpanded(false);
      }, 180);
    });

    input.addEventListener("focus", function () {
      if (currentResults.length && input.value.trim().length >= 2 && !state[stateKey].lat) {
        render(currentResults);
      }
    });

    // If the user typed an address without clicking a suggestion, resolve it on blur.
    input.addEventListener("blur", function () {
      window.setTimeout(function () {
        resolveTypedAddress();
      }, 220);
    });

    async function resolveTypedAddress() {
      if (picking) return false;
      var q = input.value.trim();
      if (!q) return false;
      if (state[stateKey].lat != null && state[stateKey].lon != null && state[stateKey].label === q) {
        return true;
      }
      try {
        var rows = await lookupAddresses(q);
        if (!rows.length) {
          if (hint) {
            hint.hidden = false;
            hint.textContent = "Address not mapped yet — pick a suggestion or preview route.";
          }
          return false;
        }
        choose(rows[0]);
        return true;
      } catch (_err) {
        return false;
      }
    }

    input._resolveAddress = resolveTypedAddress;

    if (state[stateKey].lat != null && state[stateKey].lon != null) {
      wrap.classList.add("is-mapped");
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Mapped · " + Number(state[stateKey].lat).toFixed(5) + ", " + Number(state[stateKey].lon).toFixed(5);
      }
    }
  }

  var activeModal = null;
  var escapeHandler = null;

  function closeModal(result, newId, onDone) {
    if (escapeHandler) {
      document.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }
    if (activeModal && activeModal.parentNode) activeModal.parentNode.removeChild(activeModal);
    activeModal = null;
    document.body.classList.remove("create-modal-open");
    if (typeof onDone === "function") onDone(!!result, newId || null);
  }

  function openModal(ctx, onDone) {
    if (activeModal) closeModal(false, null, null);

    var state = {
      from: { label: "", lat: null, lon: null },
      to: { label: "", lat: null, lon: null },
      packageImage: null
    };

    var modal = document.createElement("div");
    modal.className = "create-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "create-shipment-title");
    modal.innerHTML =
      '<div class="create-modal__backdrop" data-create-dismiss="1"></div>' +
      '<div class="create-modal__panel">' +
        '<header class="create-modal__head">' +
          "<div>" +
            '<h2 id="create-shipment-title">Create shipment</h2>' +
            "<p>Fill in the shipment details. From/To use live map addresses for routing.</p>" +
          "</div>" +
          '<button type="button" class="create-modal__close" data-create-dismiss="1" aria-label="Close">&times;</button>' +
        "</header>" +
        '<form class="create-form create-modal__form" id="create-shipment-form">' +
          '<div class="create-modal__body">' +
            '<div class="form-grid">' +
              field("tracking-id", "Tracking ID (optional)", 'placeholder="Auto-generated if empty"') +
              '<div class="field"><label for="service-type">Service</label>' +
                '<select id="service-type"><option>DSV Road</option><option>DSV Air Express</option><option>DSV Ocean</option><option>DSV Rail</option></select></div>' +
              field("sender", "Sender name", 'required placeholder="Who is sending"') +
              field("receiver", "Receiver name", 'required placeholder="Who receives"') +
              addressField("from-location", "From address") +
              addressField("to-location", "To address") +
              field("package-content", "Package content", 'placeholder="What is in the package"') +
              '<div class="field field--package-image">' +
                '<label for="package-image">Package photo</label>' +
                '<input id="package-image" type="file" accept="image/*">' +
                '<p class="field-hint">Optional. Customers can open it via “Preview package” on tracking.</p>' +
                '<div class="package-image-preview" id="package-image-preview" hidden>' +
                  '<img id="package-image-thumb" alt="Package preview">' +
                  '<button type="button" class="btn" id="package-image-clear">Remove photo</button>' +
                "</div>" +
              "</div>" +
              field("delivery-time", "Delivery window", 'value="9:00 PM"') +
              '<div class="field"><label for="transit-hours">Transit window (hours)</label>' +
                '<input id="transit-hours" type="number" min="6" max="720" value="72"></div>' +
              '<div class="field"><label for="start-status">Starting status</label>' +
                '<select id="start-status">' +
                  '<option value="pending">Pending / Label created</option>' +
                  '<option value="in-transit" selected>In Transit</option>' +
                  '<option value="out-for-delivery">Out for Delivery</option>' +
                  '<option value="delivered">Delivered</option>' +
                "</select></div>" +
              '<div class="field field--check"><label><input id="signature-required" type="checkbox" checked> Signature required</label></div>' +
            "</div>" +
            '<div class="route-preview" id="route-preview" hidden></div>' +
            '<p class="form-error" id="create-error" hidden></p>' +
          "</div>" +
          '<footer class="create-modal__foot">' +
            '<button type="button" class="btn" data-create-dismiss="1">Cancel</button>' +
            '<button type="button" class="btn" id="btn-preview-route">Preview route</button>' +
            '<button type="submit" class="btn btn-primary" id="btn-save-shipment">Create shipment</button>' +
          '</footer>' +
        "</form>" +
      "</div>";

    document.body.appendChild(modal);
    document.body.classList.add("create-modal-open");
    activeModal = modal;

    bindAddressAutocomplete(modal.querySelector("#from-location"), "from", state);
    bindAddressAutocomplete(modal.querySelector("#to-location"), "to", state);

    function payloadFromForm() {
      return {
        id: modal.querySelector("#tracking-id").value.trim(),
        sender: modal.querySelector("#sender").value.trim(),
        receiver: modal.querySelector("#receiver").value.trim(),
        fromLocation: state.from.label || modal.querySelector("#from-location").value.trim(),
        toLocation: state.to.label || modal.querySelector("#to-location").value.trim(),
        fromLat: state.from.lat,
        fromLon: state.from.lon,
        toLat: state.to.lat,
        toLon: state.to.lon,
        packageContent: modal.querySelector("#package-content").value.trim(),
        packageImage: state.packageImage || null,
        serviceType: modal.querySelector("#service-type").value,
        deliveryTime: modal.querySelector("#delivery-time").value.trim(),
        transitHours: Number(modal.querySelector("#transit-hours").value) || 72,
        status: modal.querySelector("#start-status").value,
        signatureRequired: modal.querySelector("#signature-required").checked
      };
    }

    function compressPackageImage(file) {
      return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type || "")) {
          reject(new Error("Choose an image file."));
          return;
        }
        if (file.size > 8 * 1024 * 1024) {
          reject(new Error("Image must be under 8 MB."));
          return;
        }
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error("Could not read image.")); };
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            var maxSide = 1280;
            var scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            var ctx2d = canvas.getContext("2d");
            ctx2d.drawImage(img, 0, 0, w, h);
            var dataUrl = canvas.toDataURL("image/jpeg", 0.78);
            if (dataUrl.length > 1200000) {
              dataUrl = canvas.toDataURL("image/jpeg", 0.62);
            }
            if (dataUrl.length > 1400000) {
              reject(new Error("Image is still too large after compression."));
              return;
            }
            resolve(dataUrl);
          };
          img.onerror = function () { reject(new Error("Invalid image file.")); };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    function setPackagePreview(dataUrl) {
      state.packageImage = dataUrl || null;
      var wrap = modal.querySelector("#package-image-preview");
      var thumb = modal.querySelector("#package-image-thumb");
      if (!wrap || !thumb) return;
      if (dataUrl) {
        thumb.src = dataUrl;
        wrap.hidden = false;
      } else {
        thumb.removeAttribute("src");
        wrap.hidden = true;
        var input = modal.querySelector("#package-image");
        if (input) input.value = "";
      }
    }

    function showError(msg) {
      var el = modal.querySelector("#create-error");
      el.hidden = !msg;
      el.textContent = msg || "";
    }

    function renderPreview(preview) {
      var box = modal.querySelector("#route-preview");
      box.hidden = false;
      box.innerHTML =
        "<h3>Route travel history</h3>" +
        '<p class="route-preview__meta"><strong>' + U().escapeHtml(String(preview.distanceKm)) + " km</strong> · ETA " +
        U().escapeHtml(preview.estimatedDelivery || "—") + "</p>" +
        '<ol class="timeline">' +
        (preview.plannedEvents || []).map(function (ev) {
          return "<li><strong>" + U().escapeHtml(ev.title) + "</strong><span>" +
            U().escapeHtml(ev.location || "") + "</span><time>" + U().escapeHtml(ev.date || "") + "</time></li>";
        }).join("") +
        "</ol>";
    }

    modal.addEventListener("click", function (event) {
      if (event.target.closest("[data-create-dismiss]")) {
        event.preventDefault();
        closeModal(false, null, onDone);
      }
    });

    escapeHandler = function (event) {
      if (event.key === "Escape") closeModal(false, null, onDone);
    };
    document.addEventListener("keydown", escapeHandler);

    modal.querySelector("#package-image").addEventListener("change", async function (event) {
      showError("");
      var file = event.target.files && event.target.files[0];
      if (!file) {
        setPackagePreview(null);
        return;
      }
      try {
        var dataUrl = await compressPackageImage(file);
        setPackagePreview(dataUrl);
      } catch (err) {
        setPackagePreview(null);
        showError(err.message || "Could not load package photo.");
      }
    });
    modal.querySelector("#package-image-clear").addEventListener("click", function () {
      setPackagePreview(null);
    });

    modal.querySelector("#btn-preview-route").addEventListener("click", async function () {
      showError("");
      var btn = modal.querySelector("#btn-preview-route");
      btn.disabled = true;
      btn.textContent = "Building route…";
      try {
        var data = await AdminAPI.previewRoute(payloadFromForm());
        renderPreview(data.preview || {});
        if (data.preview) {
          if (data.preview.fromLocation) {
            modal.querySelector("#from-location").value = data.preview.fromLocation;
            state.from = { label: data.preview.fromLocation, lat: data.preview.fromLat, lon: data.preview.fromLon };
          }
          if (data.preview.toLocation) {
            modal.querySelector("#to-location").value = data.preview.toLocation;
            state.to = { label: data.preview.toLocation, lat: data.preview.toLat, lon: data.preview.toLon };
          }
        }
      } catch (err) {
        showError(err.message || "Route preview failed.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Preview route";
      }
    });

    modal.querySelector("#create-shipment-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      showError("");
      var btn = modal.querySelector("#btn-save-shipment");
      btn.disabled = true;
      btn.textContent = "Creating…";
      try {
        var fromInput = modal.querySelector("#from-location");
        var toInput = modal.querySelector("#to-location");
        if (fromInput && typeof fromInput._resolveAddress === "function") {
          await fromInput._resolveAddress();
        }
        if (toInput && typeof toInput._resolveAddress === "function") {
          await toInput._resolveAddress();
        }
        var data = await AdminAPI.createShipment(payloadFromForm());
        if (data && data.id) {
          if (U().toast) {
            U().toast({
              title: "Shipment created",
              message: "Tracking " + data.id + " is ready."
            });
          }
          closeModal(true, data.id, onDone);
          return;
        }
        showError("Create failed.");
        if (U().toast) {
          U().toast({ type: "error", title: "Create failed", message: "Could not create tracking." });
        }
      } catch (err) {
        showError(err.message || "Could not create tracking.");
        if (U().toast) {
          U().toast({
            type: "error",
            title: "Create failed",
            message: err.message || "Could not create tracking."
          });
        }
      } finally {
        if (activeModal) {
          btn.disabled = false;
          btn.textContent = "Create shipment";
        }
      }
    });

    window.setTimeout(function () {
      var first = modal.querySelector("#sender");
      if (first) first.focus();
    }, 40);
  }

  // Back-compat: previous callers used render(root, ctx, onDone)
  function render(_root, ctx, onDone) {
    openModal(ctx, onDone);
  }

  global.AdminViews = global.AdminViews || {};
  global.AdminViews.createShipment = {
    render: render,
    open: openModal,
    close: function () { closeModal(false, null, null); },
    bindAddressAutocomplete: bindAddressAutocomplete,
    addressFieldHtml: addressField
  };
})(window);

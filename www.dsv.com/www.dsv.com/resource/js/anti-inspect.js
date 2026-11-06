(function () {
  "use strict";
  // Deterrent only. Anything the browser loads (HTML/CSS/JS) can still be
  // fetched via DevTools, curl, or a proxy. Keep secrets on the server.
  var path = String(location.pathname || "");
  // Leave the authenticated admin app usable for operators.
  if (/\/admin\/app/i.test(path) || /\/admin\/dashboard/i.test(path)) return;

  try {
    var noop = function () {};
    if (typeof console !== "undefined") {
      [
        "log",
        "debug",
        "info",
        "warn",
        "error",
        "clear",
        "table",
        "dir",
        "dirxml",
        "group",
        "groupCollapsed",
        "groupEnd",
        "trace",
        "profile",
        "profileEnd",
        "time",
        "timeEnd",
        "assert",
        "count",
      ].forEach(function (method) {
        try {
          console[method] = noop;
        } catch (e) {}
      });
    }
  } catch (e) {}

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }

  var style = document.createElement("style");
  style.setAttribute("data-anti-inspect", "1");
  style.textContent =
    "html,body{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}" +
    "input,textarea,[contenteditable],.allow-select{-webkit-user-select:text!important;user-select:text!important}";
  (document.head || document.documentElement).appendChild(style);

  document.addEventListener("contextmenu", blockEvent, true);
  document.addEventListener("dragstart", blockEvent, true);
  document.addEventListener("selectstart", function (event) {
    var target = event.target;
    if (!target) return blockEvent(event);
    var tag = String(target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
    if (target.closest && target.closest(".allow-select")) return;
    return blockEvent(event);
  }, true);
  document.addEventListener(
    "copy",
    function (event) {
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length > 80) return blockEvent(event);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (event) {
      var key = String(event.key || "").toLowerCase();
      var code = event.keyCode || event.which;
      var ctrl = event.ctrlKey || event.metaKey;
      var shift = event.shiftKey;
      var alt = event.altKey;

      // F12 / DevTools / View Source / Save
      if (key === "f12" || code === 123) return blockEvent(event);
      if (ctrl && shift && (key === "i" || key === "j" || key === "c" || key === "k" || code === 73 || code === 74 || code === 67 || code === 75)) {
        return blockEvent(event);
      }
      if (ctrl && (key === "u" || code === 85) && !shift && !alt) return blockEvent(event);
      if (ctrl && (key === "s" || code === 83) && !shift && !alt) return blockEvent(event);
      if (ctrl && (key === "p" || code === 80) && !shift && !alt) return blockEvent(event);
      if (event.metaKey && alt && (key === "i" || key === "j" || key === "c" || key === "u")) return blockEvent(event);
    },
    true
  );
})();

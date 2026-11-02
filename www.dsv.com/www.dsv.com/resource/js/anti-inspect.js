(function () {
  "use strict";
  // Deterrent only — DevTools can always be opened outside the page.
  if (/\/admin(\/|$)/i.test(location.pathname)) return;

  // Quiet public console so visitors don't see log/debug noise from third-party scripts.
  try {
    var noop = function () {};
    if (typeof console !== "undefined") {
      console.log = noop;
      console.debug = noop;
      console.info = noop;
      console.warn = noop;
      console.error = noop;
      console.clear = noop;
      console.table = noop;
      console.dir = noop;
      console.group = noop;
      console.groupCollapsed = noop;
      console.groupEnd = noop;
    }
  } catch (e) {}

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }

  document.addEventListener("contextmenu", blockEvent, true);

  document.addEventListener(
    "keydown",
    function (event) {
      var key = String(event.key || "").toLowerCase();
      var code = event.keyCode || event.which;
      var ctrl = event.ctrlKey || event.metaKey;
      var shift = event.shiftKey;
      var alt = event.altKey;

      if (key === "f12" || code === 123) return blockEvent(event);
      if (ctrl && shift && (key === "i" || key === "j" || key === "c" || code === 73 || code === 74 || code === 67)) {
        return blockEvent(event);
      }
      if (ctrl && (key === "u" || code === 85) && !shift && !alt) return blockEvent(event);
      if (ctrl && (key === "s" || code === 83) && !shift && !alt) return blockEvent(event);
      if (event.metaKey && alt && (key === "i" || key === "j" || key === "c")) return blockEvent(event);
    },
    true
  );
})();

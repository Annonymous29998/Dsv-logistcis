(function () {
  "use strict";
  // Deterrent only — DevTools can always be opened outside the page.
  if (/\/admin(\/|$)/i.test(location.pathname)) return;

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

      // F12
      if (key === "f12" || code === 123) return blockEvent(event);
      // Ctrl/Cmd + Shift + I/J/C
      if (ctrl && shift && (key === "i" || key === "j" || key === "c" || code === 73 || code === 74 || code === 67)) {
        return blockEvent(event);
      }
      // Ctrl/Cmd + U (view source)
      if (ctrl && (key === "u" || code === 85) && !shift && !alt) return blockEvent(event);
      // Ctrl/Cmd + S (save page)
      if (ctrl && (key === "s" || code === 83) && !shift && !alt) return blockEvent(event);
      // Mac: Cmd + Option + I/J/C
      if (event.metaKey && alt && (key === "i" || key === "j" || key === "c")) return blockEvent(event);
    },
    true
  );

  var armed = false;
  var lastHit = 0;
  function watchDevtools() {
    var widthGap = window.outerWidth - window.innerWidth > 160;
    var heightGap = window.outerHeight - window.innerHeight > 160;
    var open = widthGap || heightGap;
    if (!open) {
      armed = false;
      return;
    }
    var now = Date.now();
    if (!armed) {
      armed = true;
      lastHit = now;
      return;
    }
    // Only react after it stays open briefly (avoids false positives on zoom/resize).
    if (now - lastHit < 900) return;
    lastHit = now;
    try {
      console.clear();
      console.log("%cInspecting is disabled on this site.", "color:#002664;font-size:14px;font-weight:700");
    } catch (e) {}
  }

  window.setInterval(watchDevtools, 1200);
})();

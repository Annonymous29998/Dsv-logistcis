(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var emailInput = document.getElementById("login-email");
  var passwordInput = document.getElementById("login-password");
  var rememberInput = document.getElementById("remember-device");
  var errorEl = document.getElementById("login-error");
  var submitBtn = document.getElementById("login-submit");
  var submitLabel = document.getElementById("login-submit-label");
  var togglePass = document.getElementById("toggle-pass");
  var forgotLink = document.getElementById("forgot-link");

  function showError(message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function setLoading(isLoading) {
    submitBtn.disabled = !!isLoading;
    if (isLoading) {
      submitLabel.innerHTML = '<span class="spinner" aria-hidden="true"></span> Signing in…';
    } else {
      submitLabel.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Secure Login';
    }
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  // If already authenticated, go straight to the app.
  AdminAPI.me()
    .then(function (data) {
      if (data && data.authenticated) {
        window.location.replace("/admin/app");
      }
    })
    .catch(function () {});

  if (togglePass) {
    togglePass.addEventListener("click", function () {
      var next = passwordInput.type === "password" ? "text" : "password";
      passwordInput.type = next;
      togglePass.setAttribute("aria-label", next === "password" ? "Show password" : "Hide password");
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener("click", function (event) {
      event.preventDefault();
      showError("Password recovery is not connected to a mail provider in this environment. Contact your system owner to reset ADMIN_PASSWORD.");
    });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError();

    var email = (emailInput.value || "").trim();
    var password = passwordInput.value || "";

    if (!validEmail(email)) {
      showError("Enter a valid administrator email address.");
      emailInput.focus();
      return;
    }
    if (password.length < 6) {
      showError("Password must be at least 6 characters.");
      passwordInput.focus();
      return;
    }

    setLoading(true);
    try {
      var result = await AdminAPI.login(email, password, rememberInput.checked);
      window.location.replace(result.redirect || "/admin/app");
    } catch (err) {
      showError(err.message || "Unable to sign in.");
      setLoading(false);
    }
  });
})();

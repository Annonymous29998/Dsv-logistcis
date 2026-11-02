const { parseCookies, sendJson } = require("../_lib/http");
const { COOKIE_NAME, verifySessionToken } = require("../_lib/auth");
const fs = require("fs");
const path = require("path");

/**
 * Auth gate for the admin dashboard on Vercel.
 * Unauthenticated users are redirected to /admin/login.
 */
module.exports = async function handler(req, res) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) {
    res.statusCode = 302;
    res.setHeader("Location", "/admin/login");
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  try {
    const file = path.join(__dirname, "..", "..", "admin", "app.html");
    const html = fs.readFileSync(file, "utf8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(html);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: "Admin app unavailable." });
  }
};

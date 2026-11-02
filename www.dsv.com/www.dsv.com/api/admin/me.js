const { sendJson, parseCookies } = require("../_lib/http");
const { COOKIE_NAME, verifySessionToken } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) return sendJson(res, 401, { ok: false, authenticated: false });
  return sendJson(res, 200, {
    ok: true,
    authenticated: true,
    user: { email: session.email, role: session.role }
  });
};

const { sendJson } = require("../_lib/http");
const { clearSessionCookie } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  clearSessionCookie(res);
  return sendJson(res, 200, { ok: true });
};

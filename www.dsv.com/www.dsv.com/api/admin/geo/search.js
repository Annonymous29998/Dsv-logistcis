const { sendJson } = require("../../_lib/http");
const { requireAdmin } = require("../../_lib/auth");
const { searchAddresses } = require("../../_lib/geo");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams.get("q") || "";
    const results = await searchAddresses(q);
    return sendJson(res, 200, { ok: true, results });
  } catch (err) {
    return sendJson(res, 502, { ok: false, error: err.message || "Address search failed" });
  }
};

const { readJson, sendJson } = require("../../_lib/http");
const { requireAdmin } = require("../../_lib/auth");
const { previewRoute } = require("../../_lib/shipments");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const payload = await readJson(req);
    const preview = await previewRoute(payload);
    return sendJson(res, 200, { ok: true, preview });
  } catch (err) {
    return sendJson(res, statusCode(err), { ok: false, error: err.message || "Route preview failed" });
  }
};

function statusCode(err) {
  return err.status || 502;
}

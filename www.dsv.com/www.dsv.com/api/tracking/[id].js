const { sendJson } = require("../_lib/http");
const { getShipment, publicShipment } = require("../_lib/shipments");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const id = req.query.id;
    if (!id) return sendJson(res, 400, { ok: false, error: "Missing tracking id" });
    const item = await getShipment(String(id));
    if (!item) return sendJson(res, 404, { ok: false, error: "Tracking not found." });
    return sendJson(res, 200, { ok: true, id: item.id, shipment: publicShipment(item) });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || "Lookup failed" });
  }
};

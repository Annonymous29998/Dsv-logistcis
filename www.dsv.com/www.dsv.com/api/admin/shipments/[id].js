const { readJson, sendJson } = require("../../_lib/http");
const { requireAdmin } = require("../../_lib/auth");
const {
  getShipment,
  updateShipment,
  holdShipment,
  releaseHold,
  cancelShipment,
  deleteShipment,
  publicShipment
} = require("../../_lib/shipments");

module.exports = async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;

  const id = req.query.id;
  if (!id) return sendJson(res, 400, { ok: false, error: "Missing shipment id" });

  try {
    if (req.method === "GET") {
      const item = await getShipment(String(id));
      if (!item) return sendJson(res, 404, { ok: false, error: "Shipment not found." });
      return sendJson(res, 200, { ok: true, id: item.id, shipment: item });
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const payload = await readJson(req);
      const action = String(payload.action || "edit").toLowerCase();

      if (action === "hold") {
        const result = await holdShipment(String(id), payload.reason);
        return sendJson(res, 200, { ok: true, ...result });
      }
      if (action === "release-hold" || action === "release") {
        const result = await releaseHold(String(id), payload.reason || payload.note);
        return sendJson(res, 200, { ok: true, ...result });
      }
      if (action === "cancel") {
        const result = await cancelShipment(String(id), payload.reason);
        return sendJson(res, 200, { ok: true, ...result });
      }

      const result = await updateShipment(String(id), payload);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "DELETE") {
      const result = await deleteShipment(String(id));
      return sendJson(res, 200, { ok: true, ...result });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return sendJson(res, err.status || 500, {
      ok: false,
      error: err.message || "Shipment action failed"
    });
  }
};

const { readJson, sendJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { listShipments, createShipment } = require("../_lib/shipments");

module.exports = async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      const shipments = await listShipments();
      const rows = shipments.map((item) => {
        const timeline = item.timeline || [];
        const last = timeline[timeline.length - 1] || {};
        return {
          id: item.id,
          status: item.status,
          deliveryStatus: item.deliveryStatus,
          serviceType: item.serviceType,
          sender: item.sender,
          receiver: item.receiver,
          fromLocation: item.fromLocation,
          toLocation: item.toLocation,
          statusNearPlace: item.statusNearPlace,
          packageContent: item.packageContent,
          signatureRequired: !!item.signatureRequired,
          estimatedDelivery: item.estimatedDelivery,
          deliveryTime: item.deliveryTime,
          labelCreatedDate: item.labelCreatedDate,
          deliveryNotice: item.deliveryNotice,
          timeline,
          routeStops: item.routeStops || [],
          lastEvent: last.title,
          lastDate: last.date,
          lastLocation: last.location
        };
      });
      return sendJson(res, 200, { ok: true, shipments: rows, count: rows.length });
    }

    if (req.method === "POST") {
      const payload = await readJson(req);
      const created = await createShipment(payload);
      return sendJson(res, 201, { ok: true, ...created });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(res, status, { ok: false, error: err.message || "Shipment request failed" });
  }
};

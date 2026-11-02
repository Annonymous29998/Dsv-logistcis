const { sendJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { listShipments } = require("../_lib/shipments");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const shipments = await listShipments();
    const counts = {
      total: 0,
      inTransit: 0,
      outForDelivery: 0,
      delivered: 0,
      pending: 0,
      exception: 0,
      onHold: 0,
      cancelled: 0,
      active: 0
    };
    shipments.forEach((item) => {
      counts.total += 1;
      const status = String(item.status || "").toLowerCase();
      if (status === "delivered") counts.delivered += 1;
      else if (status === "out-for-delivery") counts.outForDelivery += 1;
      else if (status === "in-transit") counts.inTransit += 1;
      else if (status === "on-hold") {
        counts.onHold += 1;
        counts.exception += 1;
        counts.pending += 1;
      } else if (status === "cancelled") counts.cancelled += 1;
      else if (status === "exception") {
        counts.exception += 1;
        counts.pending += 1;
      } else if (status === "pending" || status === "label-created") counts.pending += 1;
      else counts.pending += 1;
    });
    counts.active = counts.inTransit + counts.outForDelivery;
    return sendJson(res, 200, { ok: true, summary: counts });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || "Summary failed" });
  }
};

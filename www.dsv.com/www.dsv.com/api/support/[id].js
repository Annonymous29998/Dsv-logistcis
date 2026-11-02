const { readJson, sendJson } = require("../_lib/http");
const {
  getChat,
  appendMessage,
  markCustomerRead,
  patchChatMeta,
  emptyChat,
  normalizeChat
} = require("../_lib/support");

module.exports = async function handler(req, res) {
  const id = String(req.query.id || "").trim();
  if (!id) return sendJson(res, 400, { ok: false, error: "Missing chat id" });

  try {
    if (req.method === "GET") {
      const chat = await getChat(id);
      return sendJson(res, 200, {
        ok: true,
        chat: chat || normalizeChat(emptyChat(id))
      });
    }

    if (req.method === "POST") {
      const payload = await readJson(req);
      const action = String(payload.action || "message");

      if (action === "read") {
        const chat = await markCustomerRead(id);
        return sendJson(res, 200, { ok: true, chat: chat || normalizeChat(emptyChat(id)) });
      }

      if (action === "meta") {
        const chat = await patchChatMeta(id, {
          name: payload.name,
          ip: payload.ip,
          city: payload.city,
          country: payload.country,
          countryCode: payload.countryCode,
          geoLabel: payload.geoLabel,
          awaitingAgent: payload.awaitingAgent
        });
        return sendJson(res, 200, { ok: true, chat });
      }

      const text = String(payload.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Message required" });
      const from = payload.from === "bot" ? "bot" : payload.from === "system" ? "system" : "customer";
      const chat = await appendMessage(
        id,
        { from, text, at: Date.now() },
        {
          name: payload.name,
          awaitingAgent: from === "customer" ? payload.awaitingAgent !== false : false,
          geo: {
            ip: payload.ip,
            city: payload.city,
            country: payload.country,
            countryCode: payload.countryCode,
            geoLabel: payload.geoLabel
          }
        }
      );
      return sendJson(res, 200, { ok: true, chat });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || "Support chat failed" });
  }
};

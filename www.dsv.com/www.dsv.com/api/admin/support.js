const { readJson, sendJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const {
  listChats,
  appendMessage,
  markAdminRead,
  markAgentConnected,
  setTyping,
  endChat,
  clearAllChats
} = require("../_lib/support");

module.exports = async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      const chats = await listChats();
      return sendJson(res, 200, { ok: true, chats });
    }

    if (req.method === "DELETE") {
      await clearAllChats();
      return sendJson(res, 200, { ok: true, chats: [] });
    }

    if (req.method === "POST") {
      const payload = await readJson(req);
      const action = String(payload.action || "message");

      if (action === "clear-all") {
        await clearAllChats();
        return sendJson(res, 200, { ok: true, chats: [] });
      }

      const id = String(payload.id || "").trim();
      if (!id) return sendJson(res, 400, { ok: false, error: "Missing chat id" });

      if (action === "read") {
        const chat = await markAdminRead(id);
        return sendJson(res, 200, { ok: true, chat });
      }

      if (action === "open") {
        const chat = await markAgentConnected(id);
        return sendJson(res, 200, { ok: true, chat });
      }

      if (action === "typing") {
        const chat = await setTyping(id, payload.typing !== false);
        return sendJson(res, 200, { ok: true, chat });
      }

      if (action === "end") {
        const chat = await endChat(id);
        return sendJson(res, 200, { ok: true, chat });
      }

      const text = String(payload.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Message required" });
      const chat = await appendMessage(id, { from: "agent", text, at: Date.now() });
      return sendJson(res, 200, { ok: true, chat });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || "Support inbox failed" });
  }
};

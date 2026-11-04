/**
 * Notify admin via Supabase Edge Function (Telegram secrets live there, not on Vercel).
 * Function: chat-telegram-notify
 * Secrets on Supabase: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
async function notifyChatWidgetStarted(info) {
  info = info || {};
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key) return { ok: false, skipped: true };

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;

  try {
    const res = await fetch(base + "/functions/v1/chat-telegram-notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        apikey: key,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        name: info.name || "Visitor",
        ip: info.ip || "",
        city: info.city || "",
        country: info.country || "",
        message: info.message || ""
      }),
      signal: controller ? controller.signal : undefined
    });
    const data = await res.json().catch(function () { return null; });
    if (!res.ok || !(data && data.ok)) {
      return { ok: false, error: (data && data.error) || ("HTTP " + res.status) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || "Edge notify failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function notifyChatWidgetStartedAsync(info) {
  // Fire-and-forget — never block the chat API on Telegram.
  return notifyChatWidgetStarted(info).catch(function () {
    return { ok: false };
  });
}

module.exports = {
  notifyChatWidgetStarted: notifyChatWidgetStartedAsync
};

/**
 * Telegram alerts for support chat (server-only env vars).
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID must be set in Vercel / .env
 */
async function sendTelegramMessage(text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId || !text) return { ok: false, skipped: true };

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 3500),
        disable_web_page_preview: true
      }),
      signal: controller ? controller.signal : undefined
    });
    const data = await res.json().catch(function () { return null; });
    if (!res.ok || !(data && data.ok)) {
      return { ok: false, error: (data && data.description) || ("HTTP " + res.status) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || "Telegram request failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function notifyChatWidgetStarted(info) {
  info = info || {};
  const lines = [
    "💬 Someone used the chat widget",
    "",
    "Name: " + (info.name || "Visitor"),
    "IP: " + (info.ip || "—"),
    "City: " + (info.city || "—")
  ];
  if (info.country) lines.push("Country: " + info.country);
  if (info.message) {
    lines.push("");
    lines.push("First message:");
    lines.push(String(info.message).slice(0, 500));
  }
  // Fire-and-forget — never block the chat API on Telegram.
  return sendTelegramMessage(lines.join("\n")).catch(function () {
    return { ok: false };
  });
}

module.exports = {
  sendTelegramMessage,
  notifyChatWidgetStarted
};

/**
 * Sends Telegram alerts when a visitor starts a support chat.
 * Secrets (Supabase Edge Function secrets — not Vercel):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const botToken = String(Deno.env.get("TELEGRAM_BOT_TOKEN") || "").trim();
  const chatId = String(Deno.env.get("TELEGRAM_CHAT_ID") || "").trim();
  if (!botToken || !chatId) {
    return Response.json(
      { ok: false, error: "Telegram secrets are not configured on this Edge Function." },
      { status: 500 }
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const name = String(payload.name || "Visitor");
  const ip = String(payload.ip || "—");
  const city = String(payload.city || "—");
  const country = String(payload.country || "").trim();
  const message = String(payload.message || "").trim();

  const lines = [
    "💬 Someone used the chat widget",
    "",
    `Name: ${name}`,
    `IP: ${ip}`,
    `City: ${city}`
  ];
  if (country) lines.push(`Country: ${country}`);
  if (message) {
    lines.push("");
    lines.push("First message:");
    lines.push(message.slice(0, 500));
  }

  const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join("\n").slice(0, 3500),
      disable_web_page_preview: true
    })
  });

  const data = await telegramRes.json().catch(() => null);
  if (!telegramRes.ok || !(data && data.ok)) {
    return Response.json(
      {
        ok: false,
        error: (data && (data as { description?: string }).description) || `Telegram HTTP ${telegramRes.status}`
      },
      { status: 502 }
    );
  }

  return Response.json({ ok: true });
});

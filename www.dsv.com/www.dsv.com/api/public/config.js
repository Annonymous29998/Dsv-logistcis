const { sendJson } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  const realtime = !!(supabaseUrl && supabaseAnonKey);

  return sendJson(res, 200, {
    ok: true,
    realtime,
    supabaseUrl: realtime ? supabaseUrl : null,
    supabaseAnonKey: realtime ? supabaseAnonKey : null
  });
};

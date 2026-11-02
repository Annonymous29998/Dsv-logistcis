const crypto = require("crypto");
const { parseCookies, setCookie } = require("./http");

const COOKIE_NAME = "dsv_admin_session";

function adminConfig() {
  return {
    email: String(process.env.ADMIN_EMAIL || "admin@dsv.com").trim().toLowerCase(),
    password: String(process.env.ADMIN_PASSWORD || ""),
    secret: String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-only-change-me"),
    ttl: Number(process.env.ADMIN_SESSION_TTL || 43200)
  };
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionToken(email) {
  const cfg = adminConfig();
  const body = b64url(JSON.stringify({
    email,
    role: "administrator",
    exp: Math.floor(Date.now() / 1000) + cfg.ttl
  }));
  const sig = sign(body, cfg.secret);
  return `${body}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const cfg = adminConfig();
  const [body, sig] = token.split(".");
  const expected = sign(body, cfg.secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(body));
    if (!data || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (data.role !== "administrator") return null;
    return data;
  } catch (err) {
    return null;
  }
}

function requireAdmin(req, res) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) {
    const { sendJson } = require("./http");
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return null;
  }
  return session;
}

function writeSessionCookie(res, token, remember) {
  const cfg = adminConfig();
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  setCookie(res, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: remember ? cfg.ttl : undefined
  });
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  setCookie(res, COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: 0
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyCredentials(email, password) {
  const cfg = adminConfig();
  if (!cfg.password) return false;
  return (
    safeEqual(String(email || "").trim().toLowerCase(), cfg.email) &&
    safeEqual(String(password || ""), cfg.password)
  );
}

/**
 * Authenticate against Supabase Auth and require membership in public.admin_users.
 * Falls back to env ADMIN_EMAIL/ADMIN_PASSWORD only if Supabase is unavailable.
 */
async function authenticateAdmin(email, password) {
  const normalized = String(email || "").trim().toLowerCase();
  const pass = String(password || "");
  if (!normalized || !pass) return null;

  try {
    const { getSupabase } = require("./supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalized,
      password: pass
    });
    if (error || !data || !data.user) {
      // Keep env fallback for local/dev if Auth user is missing.
      if (verifyCredentials(normalized, pass)) {
        return { email: normalized, role: "administrator", source: "env" };
      }
      return null;
    }

    const { data: adminRow, error: adminErr } = await supabase
      .from("admin_users")
      .select("email, role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (adminErr || !adminRow) {
      try { await supabase.auth.signOut(); } catch (e) {}
      return null;
    }

    return {
      email: adminRow.email || data.user.email || normalized,
      role: adminRow.role || "administrator",
      userId: data.user.id,
      source: "supabase"
    };
  } catch (err) {
    if (verifyCredentials(normalized, pass)) {
      return { email: normalized, role: "administrator", source: "env" };
    }
    return null;
  }
}

module.exports = {
  COOKIE_NAME,
  adminConfig,
  createSessionToken,
  verifySessionToken,
  requireAdmin,
  writeSessionCookie,
  clearSessionCookie,
  verifyCredentials,
  authenticateAdmin
};

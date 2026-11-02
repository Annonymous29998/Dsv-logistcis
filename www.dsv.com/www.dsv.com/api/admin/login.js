const { readJson, sendJson } = require("../_lib/http");
const {
  authenticateAdmin,
  createSessionToken,
  writeSessionCookie
} = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const payload = await readJson(req);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const remember = !!payload.remember;

    if (!email || !email.includes("@") || !password) {
      return sendJson(res, 400, { ok: false, error: "Enter a valid email and password." });
    }

    const admin = await authenticateAdmin(email, password);
    if (!admin) {
      return sendJson(res, 401, { ok: false, error: "Invalid administrator credentials." });
    }

    const token = createSessionToken(admin.email);
    writeSessionCookie(res, token, remember);
    return sendJson(res, 200, {
      ok: true,
      user: { email: admin.email, role: admin.role || "administrator" },
      redirect: "/admin/app"
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || "Login failed" });
  }
};

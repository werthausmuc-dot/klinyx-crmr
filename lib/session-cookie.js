const crypto = require("crypto");
const sessions = require("./sessions");

const COOKIE_NAME = "klinyx_sid";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn(
    "[warn] SESSION_SECRET is not set — using a temporary random secret.\n" +
    "       Every restart will log everyone out. Set SESSION_SECRET in .env for production."
  );
  SESSION_SECRET = crypto.randomBytes(48).toString("hex");
}

function setSessionCookie(res, sessionId) {
  const signed = sessions.sign(sessionId, SESSION_SECRET);
  const parts = [
    COOKIE_NAME + "=" + encodeURIComponent(signed),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + 30 * 24 * 60 * 60
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", COOKIE_NAME + "=; Path=/; HttpOnly; Max-Age=0");
}

function getSessionIdFromRequest(req, parseCookies) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  return sessions.unsign(raw, SESSION_SECRET);
}

module.exports = { setSessionCookie, clearSessionCookie, getSessionIdFromRequest, COOKIE_NAME };

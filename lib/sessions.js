// In-memory session store + signed cookie helpers. No external dependency:
// Node's built-in crypto module is all this needs. Sessions live only in
// process memory, so restarting the server logs everyone out — an
// acceptable trade-off for a small internal tool; note it in the README.

const crypto = require("crypto");

const sessions = new Map(); // sessionId -> { userId, expiresAt }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSession(userId) {
  const id = crypto.randomUUID();
  sessions.set(id, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function destroySession(id) {
  sessions.delete(id);
}

// Sweep expired sessions hourly so a long-running process doesn't
// accumulate them forever. unref() so this timer never keeps the process
// alive on its own.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(id);
  }
}, 60 * 60 * 1000);
if (sweepTimer.unref) sweepTimer.unref();

function sign(value, secret) {
  const h = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return value + "." + h;
}

function unsign(signed, secret) {
  if (!signed || typeof signed !== "string") return null;
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", secret).update(value).digest("hex");
  let sigBuf, expBuf;
  try {
    sigBuf = Buffer.from(sig, "hex");
    expBuf = Buffer.from(expected, "hex");
  } catch (e) {
    return null;
  }
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return value;
}

module.exports = { createSession, getSession, destroySession, sign, unsign };

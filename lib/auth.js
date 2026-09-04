const crypto = require("crypto");
const { sendJson } = require("./http-utils");

// Password hashing via Node's built-in scrypt — no external dependency.
// Stored as "salt:hash", both hex.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || stored.indexOf(":") === -1) return false;
  const [salt, hashHex] = stored.split(":");
  let hashBuf, suppliedBuf;
  try {
    hashBuf = Buffer.from(hashHex, "hex");
    suppliedBuf = crypto.scryptSync(String(password), salt, 64);
  } catch (e) {
    return false;
  }
  return hashBuf.length === suppliedBuf.length && crypto.timingSafeEqual(hashBuf, suppliedBuf);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active !== false,
    createdAt: user.createdAt
  };
}

function requireAuth(req, res) {
  if (!req.user) {
    sendJson(res, 401, { error: "not_authenticated" });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (!requireAuth(req, res)) return false;
  if (req.user.role !== "admin") {
    sendJson(res, 403, { error: "admin_only" });
    return false;
  }
  return true;
}

// Small in-memory brute-force guard: N failed attempts per username locks
// that username out for a cooldown window. Resets on success. Intentionally
// simple — good enough for a small internal tool's login form, not a
// substitute for rate limiting at the network edge if ever exposed
// more broadly.
const failedAttempts = new Map(); // username -> { count, lockedUntil }
const MAX_ATTEMPTS = 8;
const LOCK_MS = 5 * 60 * 1000;

function isLocked(username) {
  const key = String(username || "").toLowerCase();
  const rec = failedAttempts.get(key);
  if (!rec) return false;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true;
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) failedAttempts.delete(key);
  return false;
}

function recordFailure(username) {
  const key = String(username || "").toLowerCase();
  const rec = failedAttempts.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  failedAttempts.set(key, rec);
}

function recordSuccess(username) {
  failedAttempts.delete(String(username || "").toLowerCase());
}

module.exports = {
  hashPassword,
  verifyPassword,
  sanitizeUser,
  requireAuth,
  requireAdmin,
  isLocked,
  recordFailure,
  recordSuccess
};

const store = require("../lib/store");
const sessions = require("../lib/sessions");
const { hashPassword, verifyPassword, sanitizeUser, isLocked, recordFailure, recordSuccess } = require("../lib/auth");
const { sendJson, readJsonBody, parseCookies } = require("../lib/http-utils");
const { setSessionCookie, clearSessionCookie, getSessionIdFromRequest } = require("../lib/session-cookie");

module.exports = function registerAuthRoutes(router) {
  // GET /api/auth/me — who (if anyone) is logged in, and whether the very
  // first admin account still needs to be created.
  router.get("/api/auth/me", async (req, res) => {
    sendJson(res, 200, { user: req.user || null, needsSetup: !store.hasAnyUsers() });
  });

  // POST /api/auth/setup — creates the first admin account. Only works
  // while there are zero users in the system, so it can't be reused later
  // to mint extra admins (use /api/users for that, as an existing admin).
  router.post("/api/auth/setup", async (req, res) => {
    if (store.hasAnyUsers()) return sendJson(res, 409, { error: "already_initialized" });
    const body = await readJsonBody(req);
    const { username, password, name } = body || {};
    if (!username || !password || String(password).length < 8) {
      return sendJson(res, 400, { error: "invalid_input", message: "Потрібні логін і пароль (мінімум 8 символів)." });
    }
    const user = store.create("users", {
      username: String(username).trim(),
      passwordHash: hashPassword(String(password)),
      name: String(name || username).trim(),
      role: "admin",
      active: true
    });
    const sid = sessions.createSession(user.id);
    setSessionCookie(res, sid);
    sendJson(res, 200, { user: sanitizeUser(user) });
  });

  router.post("/api/auth/login", async (req, res) => {
    const body = await readJsonBody(req);
    const { username, password } = body || {};
    if (!username || !password) {
      return sendJson(res, 400, { error: "invalid_input", message: "Вкажіть логін і пароль." });
    }
    if (isLocked(username)) {
      return sendJson(res, 429, { error: "locked", message: "Забагато невдалих спроб. Спробуйте пізніше." });
    }
    const user = store.findUserByUsername(username);
    if (!user || user.active === false || !verifyPassword(password, user.passwordHash)) {
      recordFailure(username);
      return sendJson(res, 401, { error: "invalid_credentials", message: "Невірний логін або пароль." });
    }
    recordSuccess(username);
    const sid = sessions.createSession(user.id);
    setSessionCookie(res, sid);
    sendJson(res, 200, { user: sanitizeUser(user) });
  });

  router.post("/api/auth/logout", async (req, res) => {
    const sid = getSessionIdFromRequest(req, parseCookies);
    if (sid) sessions.destroySession(sid);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });
};

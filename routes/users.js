const store = require("../lib/store");
const { hashPassword, sanitizeUser, requireAdmin } = require("../lib/auth");
const { sendJson, readJsonBody } = require("../lib/http-utils");

module.exports = function registerUserRoutes(router) {
  // Every route here is admin-only: employees don't manage other accounts.

  router.get("/api/users", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, store.list("users").map(sanitizeUser));
  });

  router.post("/api/users", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readJsonBody(req);
    const { username, password, name, role } = body || {};
    if (!username || !password || String(password).length < 8) {
      return sendJson(res, 400, { error: "invalid_input", message: "Потрібні логін і пароль (мінімум 8 символів)." });
    }
    if (store.findUserByUsername(username)) {
      return sendJson(res, 409, { error: "username_taken", message: "Такий логін вже існує." });
    }
    const user = store.create("users", {
      username: String(username).trim(),
      passwordHash: hashPassword(String(password)),
      name: String(name || username).trim(),
      role: role === "admin" ? "admin" : "employee",
      active: true
    });
    sendJson(res, 201, sanitizeUser(user));
  });

  router.patch("/api/users/:id", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const existing = store.get("users", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });

    const body = await readJsonBody(req);
    const patch = {};
    const { name, role, active, password } = body || {};
    if (typeof name === "string") patch.name = name.trim();
    if (role === "admin" || role === "employee") {
      if (existing.role === "admin" && role !== "admin") {
        const admins = store.list("users").filter((u) => u.role === "admin" && u.id !== existing.id);
        if (admins.length === 0) {
          return sendJson(res, 400, { error: "last_admin", message: "Не можна прибрати роль адміна в останнього адміністратора." });
        }
      }
      patch.role = role;
    }
    if (typeof active === "boolean") {
      if (existing.role === "admin" && active === false) {
        const activeAdmins = store.list("users").filter((u) => u.role === "admin" && u.active !== false && u.id !== existing.id);
        if (activeAdmins.length === 0) {
          return sendJson(res, 400, { error: "last_admin", message: "Не можна вимкнути останнього активного адміністратора." });
        }
      }
      patch.active = active;
    }
    if (password) {
      if (String(password).length < 8) {
        return sendJson(res, 400, { error: "invalid_input", message: "Пароль має бути не коротшим за 8 символів." });
      }
      patch.passwordHash = hashPassword(String(password));
    }

    const updated = store.update("users", params.id, patch);
    sendJson(res, 200, sanitizeUser(updated));
  });

  router.delete("/api/users/:id", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const existing = store.get("users", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    if (existing.role === "admin") {
      const otherAdmins = store.list("users").filter((u) => u.role === "admin" && u.id !== existing.id);
      if (otherAdmins.length === 0) {
        return sendJson(res, 400, { error: "last_admin", message: "Не можна видалити останнього адміністратора." });
      }
    }
    if (existing.id === req.user.id) {
      return sendJson(res, 400, { error: "self_delete", message: "Не можна видалити власний обліковий запис." });
    }
    store.remove("users", params.id);
    sendJson(res, 200, { ok: true });
  });
};

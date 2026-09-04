const store = require("../lib/store");
const { requireAuth } = require("../lib/auth");
const { sendJson, readJsonBody } = require("../lib/http-utils");

const STATUSES = ["lead", "active", "inactive"];

function clean(body, existing) {
  const data = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.phone === "string") data.phone = body.phone.trim();
  if (typeof body.email === "string") data.email = body.email.trim();
  if (typeof body.address === "string") data.address = body.address.trim();
  if (typeof body.notes === "string") data.notes = body.notes.trim();
  if (STATUSES.includes(body.status)) data.status = body.status;
  if (!existing && !data.status) data.status = "lead";
  return data;
}

module.exports = function registerClientRoutes(router) {
  router.get("/api/clients", async (req, res) => {
    if (!requireAuth(req, res)) return;
    sendJson(res, 200, store.list("clients"));
  });

  router.post("/api/clients", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const body = await readJsonBody(req);
    const data = clean(body, null);
    if (!data.name) return sendJson(res, 400, { error: "invalid_input", message: "Вкажіть ім'я або назву клієнта." });
    data.createdBy = req.user.id;
    sendJson(res, 201, store.create("clients", data));
  });

  router.patch("/api/clients/:id", async (req, res, params) => {
    if (!requireAuth(req, res)) return;
    const existing = store.get("clients", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    const body = await readJsonBody(req);
    const patch = clean(body, existing);
    if ("name" in patch && !patch.name) return sendJson(res, 400, { error: "invalid_input", message: "Ім'я не може бути порожнім." });
    sendJson(res, 200, store.update("clients", params.id, patch));
  });

  router.delete("/api/clients/:id", async (req, res, params) => {
    if (!requireAuth(req, res)) return;
    const existing = store.get("clients", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    store.remove("clients", params.id);
    sendJson(res, 200, { ok: true });
  });
};

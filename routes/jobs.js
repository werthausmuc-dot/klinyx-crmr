const store = require("../lib/store");
const { requireAuth } = require("../lib/auth");
const { sendJson, readJsonBody } = require("../lib/http-utils");

const STATUSES = ["scheduled", "done", "cancelled"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(body, existing) {
  const data = {};
  if (typeof body.clientId === "string") data.clientId = body.clientId;
  if (typeof body.date === "string" && DATE_RE.test(body.date)) data.date = body.date;
  if (typeof body.time === "string") data.time = body.time.trim();
  if (typeof body.service === "string") data.service = body.service.trim();
  if (typeof body.address === "string") data.address = body.address.trim();
  if (body.price === null || body.price === "") data.price = null;
  else if (typeof body.price === "number") data.price = body.price;
  else if (typeof body.price === "string" && body.price.trim() !== "" && !Number.isNaN(Number(body.price))) data.price = Number(body.price);
  if (typeof body.notes === "string") data.notes = body.notes.trim();
  if (STATUSES.includes(body.status)) data.status = body.status;
  if (!existing && !data.status) data.status = "scheduled";
  return data;
}

module.exports = function registerJobRoutes(router) {
  router.get("/api/jobs", async (req, res) => {
    if (!requireAuth(req, res)) return;
    sendJson(res, 200, store.list("jobs"));
  });

  router.post("/api/jobs", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const body = await readJsonBody(req);
    const data = clean(body, null);
    if (!data.clientId) return sendJson(res, 400, { error: "invalid_input", message: "Оберіть клієнта." });
    if (!store.get("clients", data.clientId)) return sendJson(res, 400, { error: "invalid_input", message: "Клієнта не знайдено." });
    if (!data.date) return sendJson(res, 400, { error: "invalid_input", message: "Вкажіть дату у форматі РРРР-ММ-ДД." });
    data.createdBy = req.user.id;
    sendJson(res, 201, store.create("jobs", data));
  });

  router.patch("/api/jobs/:id", async (req, res, params) => {
    if (!requireAuth(req, res)) return;
    const existing = store.get("jobs", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    const body = await readJsonBody(req);
    const patch = clean(body, existing);
    if (patch.clientId && !store.get("clients", patch.clientId)) {
      return sendJson(res, 400, { error: "invalid_input", message: "Клієнта не знайдено." });
    }
    sendJson(res, 200, store.update("jobs", params.id, patch));
  });

  router.delete("/api/jobs/:id", async (req, res, params) => {
    if (!requireAuth(req, res)) return;
    const existing = store.get("jobs", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    store.remove("jobs", params.id);
    sendJson(res, 200, { ok: true });
  });
};

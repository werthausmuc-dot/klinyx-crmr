const store = require("../lib/store");
const { requireAuth } = require("../lib/auth");
const { sendJson, readJsonBody } = require("../lib/http-utils");

const STATUSES = ["unpaid", "paid"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(body, existing) {
  const data = {};
  if (typeof body.clientId === "string") data.clientId = body.clientId;
  if (typeof body.amount === "number") data.amount = body.amount;
  else if (typeof body.amount === "string" && body.amount.trim() !== "" && !Number.isNaN(Number(body.amount))) data.amount = Number(body.amount);
  if (typeof body.issueDate === "string" && DATE_RE.test(body.issueDate)) data.issueDate = body.issueDate;
  if (typeof body.dueDate === "string" && DATE_RE.test(body.dueDate)) data.dueDate = body.dueDate;
  if (typeof body.note === "string") data.note = body.note.trim();
  if (typeof body.jobId === "string" || body.jobId === null) data.jobId = body.jobId || null;
  if (STATUSES.includes(body.status)) data.status = body.status;
  if (!existing && !data.status) data.status = "unpaid";
  return data;
}

module.exports = function registerInvoiceRoutes(router) {
  router.get("/api/invoices", async (req, res) => {
    if (!requireAuth(req, res)) return;
    sendJson(res, 200, store.list("invoices"));
  });

  router.post("/api/invoices", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const body = await readJsonBody(req);
    const data = clean(body, null);
    if (!data.clientId) return sendJson(res, 400, { error: "invalid_input", message: "Оберіть клієнта." });
    if (!store.get("clients", data.clientId)) return sendJson(res, 400, { error: "invalid_input", message: "Клієнта не знайдено." });
    if (!data.amount || data.amount <= 0) return sendJson(res, 400, { error: "invalid_input", message: "Вкажіть суму рахунку." });
    data.createdBy = req.user.id;
    sendJson(res, 201, store.create("invoices", data));
  });

  router.patch("/api/invoices/:id", async (req, res, params) => {
    if (!requireAuth(req, res)) return;
    const existing = store.get("invoices", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    const body = await readJsonBody(req);
    const patch = clean(body, existing);
    if (patch.clientId && !store.get("clients", patch.clientId)) {
      return sendJson(res, 400, { error: "invalid_input", message: "Клієнта не знайдено." });
    }
    sendJson(res, 200, store.update("invoices", params.id, patch));
  });

  router.delete("/api/invoices/:id", async (req, res, params) => {
    if (!requireAuth(req, res)) return;
    const existing = store.get("invoices", params.id);
    if (!existing) return sendJson(res, 404, { error: "not_found" });
    store.remove("invoices", params.id);
    sendJson(res, 200, { ok: true });
  });
};

const path = require("path");
const http = require("http");

const { loadEnv } = require("./lib/env");
loadEnv();

const store = require("./lib/store");
const { sanitizeUser } = require("./lib/auth");
const sessions = require("./lib/sessions");
const { sendJson, serveStatic, parseCookies } = require("./lib/http-utils");
const { getSessionIdFromRequest } = require("./lib/session-cookie");
const createRouter = require("./lib/router");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const router = createRouter();
require("./routes/auth")(router);
require("./routes/users")(router);
require("./routes/clients")(router);
require("./routes/jobs")(router);
require("./routes/invoices")(router);

function getCurrentUser(req) {
  const sid = getSessionIdFromRequest(req, parseCookies);
  if (!sid) return null;
  const session = sessions.getSession(sid);
  if (!session) return null;
  const user = store.get("users", session.userId);
  if (!user || user.active === false) return null;
  return sanitizeUser(user);
}

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(async () => {
      const parsedUrl = new URL(req.url, "http://" + (req.headers.host || "localhost"));
      const pathname = decodeURIComponent(parsedUrl.pathname);

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "same-origin");

      req.user = getCurrentUser(req);

      const match = router.match(req.method, pathname);
      if (match) {
        req.query = Object.fromEntries(parsedUrl.searchParams);
        await match.handler(req, res, match.params);
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        serveStatic(PUBLIC_DIR, req, res, pathname);
        return;
      }

      sendJson(res, 405, { error: "method_not_allowed" });
    })
    .catch((err) => {
      if (err && err.status) {
        sendJson(res, err.status, { error: "bad_request", message: err.message });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: "server_error" });
    });
});

server.listen(PORT, () => {
  console.log("Kliny X CRM running on http://localhost:" + PORT);
  console.log(store.hasAnyUsers() ? "Ready — sign in at /." : "No users yet — open the app in a browser to create the first admin account.");
});

// Tiny embedded database: everything lives in one JSON file on disk.
// No native modules, no external database server — just fs.readFileSync /
// fs.writeFileSync. Fine for a small business CRM (hundreds to low
// thousands of records). Writes are synchronous so there is no risk of two
// requests interleaving a write against each other.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY_DB = {
  users: [],
  clients: [],
  jobs: [],
  invoices: []
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    save(EMPTY_DB);
    return structuredClone(EMPTY_DB);
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(EMPTY_DB), parsed);
  } catch (err) {
    // A corrupt file should never take the whole app down — back it up and
    // start fresh rather than crash-looping on every request.
    const backup = DB_FILE + ".corrupt-" + Date.now();
    try { fs.copyFileSync(DB_FILE, backup); } catch (_) { /* best effort */ }
    console.error("[store] db.json was unreadable, backed up to " + backup + " and starting fresh:", err.message);
    save(EMPTY_DB);
    return structuredClone(EMPTY_DB);
  }
}

function save(data) {
  ensureDataDir();
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE); // atomic on the same filesystem
}

let db = load();

function persist() {
  save(db);
}

function id() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function assertCollection(name) {
  if (!Object.prototype.hasOwnProperty.call(db, name)) {
    throw new Error("Unknown collection: " + name);
  }
}

const store = {
  list(name) {
    assertCollection(name);
    return db[name].slice();
  },

  get(name, recordId) {
    assertCollection(name);
    return db[name].find((r) => r.id === recordId) || null;
  },

  create(name, data) {
    assertCollection(name);
    const record = Object.assign({}, data, {
      id: id(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    db[name].push(record);
    persist();
    return record;
  },

  update(name, recordId, patch) {
    assertCollection(name);
    const idx = db[name].findIndex((r) => r.id === recordId);
    if (idx === -1) return null;
    db[name][idx] = Object.assign({}, db[name][idx], patch, {
      id: recordId,
      updatedAt: nowIso()
    });
    persist();
    return db[name][idx];
  },

  remove(name, recordId) {
    assertCollection(name);
    const before = db[name].length;
    db[name] = db[name].filter((r) => r.id !== recordId);
    persist();
    return db[name].length < before;
  },

  // ---- user-specific helpers ----
  findUserByUsername(username) {
    const needle = String(username || "").trim().toLowerCase();
    return db.users.find((u) => u.username.toLowerCase() === needle) || null;
  },

  hasAnyUsers() {
    return db.users.length > 0;
  },

  // Exposed for tests / scripts; not used by the running server.
  _raw() {
    return db;
  }
};

module.exports = store;

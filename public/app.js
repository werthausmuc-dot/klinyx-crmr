(function () {
  "use strict";

  /* ============ constants ============ */
  var SERVICE_TYPES = [
    "Генеральне прибирання",
    "Підтримуюче прибирання",
    "Прибирання після ремонту",
    "Миття вікон",
    "Хімчистка м'яких меблів",
    "Прибирання офісу / комерційного приміщення",
    "Прибирання ресторану / бару",
    "Інше"
  ];
  var DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  var MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
  var POLL_MS = 20000;

  /* ============ state ============ */
  var state = {
    me: null,
    clients: new Map(),
    jobs: new Map(),
    invoices: new Map(),
    users: [],
    view: "dashboard",
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    selectedDay: null,
    clientFilter: "all",
    clientQuery: "",
    invoiceFilter: "all"
  };

  function todayStr() { return fmtDate(new Date()); }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseDate(s) { var p = s.split("-"); return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)); }
  function fmtDateHuman(s) {
    if (!s) return "—";
    var d = parseDate(s);
    return d.getDate() + " " + MONTHS[d.getMonth()].toLowerCase().slice(0, 3) + ".";
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return "€" + n.toLocaleString("de-DE", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ============ toast ============ */
  function toast(msg, isError) {
    var host = document.getElementById("toast-host");
    var el = document.createElement("div");
    el.className = "toast" + (isError ? " err" : "");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 3400);
  }

  /* ============ API client ============ */
  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) {
        showLogin();
        throw { code: "not_authenticated" };
      }
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || "Сталася помилка");
          err.code = data && data.error;
          throw err;
        }
        return data;
      });
    });
  }

  /* ============ auth flow ============ */
  function boot() {
    api("GET", "/api/auth/me").then(function (data) {
      if (data.needsSetup) return showSetup();
      if (!data.user) return showLogin();
      enterApp(data.user);
    }).catch(function () {
      showLogin();
    });
  }

  function hideAllScreens() {
    ["screen-loading", "screen-setup", "screen-login", "app"].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
  }

  function showSetup() {
    hideAllScreens();
    document.getElementById("screen-setup").hidden = false;
  }

  function showLogin() {
    hideAllScreens();
    document.getElementById("screen-login").hidden = false;
    state.me = null;
  }

  function enterApp(user) {
    state.me = user;
    hideAllScreens();
    document.getElementById("app").hidden = false;
    document.getElementById("me-name").textContent = user.name || user.username;
    document.getElementById("me-role").textContent = user.role === "admin" ? "Адміністратор" : "Співробітник";
    document.getElementById("me-avatar").textContent = (user.name || user.username).trim().slice(0, 1).toUpperCase();
    document.getElementById("nav-team").hidden = user.role !== "admin";
    setView("dashboard");
    loadAll();
    if (!window.__klinyxPoll) {
      window.__klinyxPoll = setInterval(loadAll, POLL_MS);
    }
  }

  document.getElementById("setup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var errEl = document.getElementById("setup-error");
    errEl.hidden = true;
    api("POST", "/api/auth/setup", {
      name: document.getElementById("su-name").value.trim(),
      username: document.getElementById("su-username").value.trim(),
      password: document.getElementById("su-password").value
    }).then(function (data) {
      enterApp(data.user);
    }).catch(function (err) {
      errEl.textContent = err.message || "Не вдалося створити акаунт";
      errEl.hidden = false;
    });
  });

  document.getElementById("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var errEl = document.getElementById("login-error");
    errEl.hidden = true;
    api("POST", "/api/auth/login", {
      username: document.getElementById("li-username").value.trim(),
      password: document.getElementById("li-password").value
    }).then(function (data) {
      enterApp(data.user);
    }).catch(function (err) {
      errEl.textContent = err.message || "Не вдалося увійти";
      errEl.hidden = false;
    });
  });

  document.getElementById("btn-logout").addEventListener("click", function () {
    api("POST", "/api/auth/logout").then(function () {
      if (window.__klinyxPoll) { clearInterval(window.__klinyxPoll); window.__klinyxPoll = null; }
      showLogin();
    });
  });

  /* ============ data loading ============ */
  function loadAll() {
    return Promise.all([
      api("GET", "/api/clients"),
      api("GET", "/api/jobs"),
      api("GET", "/api/invoices"),
      state.me && state.me.role === "admin" ? api("GET", "/api/users") : Promise.resolve(null)
    ]).then(function (res) {
      state.clients = new Map(res[0].map(function (c) { return [c.id, c]; }));
      state.jobs = new Map(res[1].map(function (j) { return [j.id, j]; }));
      state.invoices = new Map(res[2].map(function (i) { return [i.id, i]; }));
      if (res[3]) state.users = res[3];
      render();
    }).catch(function (err) {
      if (err && err.code !== "not_authenticated") toast(err.message || "Не вдалося оновити дані", true);
    });
  }

  /* ============ navigation ============ */
  function setView(v) {
    state.view = v;
    document.querySelectorAll(".view").forEach(function (el) { el.classList.remove("active"); });
    document.getElementById("view-" + v).classList.add("active");
    document.querySelectorAll(".nav-item").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-view") === v);
    });
    render();
  }

  /* ============ derived data ============ */
  function clientName(id) {
    var c = state.clients.get(id);
    return c ? c.name : "(клієнт видалений)";
  }
  function jobsSorted() {
    return Array.from(state.jobs.values()).slice().sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
  }
  function invoicesList() { return Array.from(state.invoices.values()); }
  function clientsList() { return Array.from(state.clients.values()); }
  function isOverdue(inv) { return inv.status === "unpaid" && inv.dueDate && inv.dueDate < todayStr(); }
  function nextJobForClient(clientId) {
    var today = todayStr();
    var upcoming = jobsSorted().filter(function (j) { return j.clientId === clientId && j.status === "scheduled" && j.date >= today; });
    return upcoming[0] || null;
  }
  function statusLabelJob(s) { return { scheduled: "заплановано", done: "виконано", cancelled: "скасовано" }[s] || s; }
  function statusLabelClient(s) { return { lead: "лід", active: "активний", inactive: "неактивний" }[s] || s; }
  function statusLabelInvoice(inv) {
    if (isOverdue(inv)) return "прострочено";
    return { unpaid: "неоплачено", paid: "оплачено" }[inv.status] || inv.status;
  }

  /* ============ render: dashboard ============ */
  function renderDashboard() {
    var today = new Date();
    document.getElementById("today-label").textContent = today.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" });

    var jobs = jobsSorted();
    var todayS = todayStr();
    var weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
    var weekEndS = fmtDate(weekEnd);

    var weekJobs = jobs.filter(function (j) { return j.status === "scheduled" && j.date >= todayS && j.date <= weekEndS; });
    var todayJobs = jobs.filter(function (j) { return j.date === todayS && j.status !== "cancelled"; });
    var unpaidSum = invoicesList().filter(function (i) { return i.status === "unpaid"; }).reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0);

    document.getElementById("stat-clients").textContent = state.clients.size;
    document.getElementById("stat-week-jobs").textContent = weekJobs.length;
    document.getElementById("stat-today").textContent = todayJobs.length;
    document.getElementById("stat-unpaid").textContent = fmtMoney(unpaidSum);

    renderCalendar();
    renderAgenda();
    renderReminders();
  }

  function renderCalendar() {
    document.getElementById("cal-month-label").textContent = MONTHS[state.calMonth] + " " + state.calYear;
    var dowRow = document.getElementById("cal-dow-row");
    dowRow.innerHTML = DOW.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join("");

    var first = new Date(state.calYear, state.calMonth, 1);
    var startOffset = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    var prevDays = new Date(state.calYear, state.calMonth, 0).getDate();

    var jobsByDate = {};
    jobsSorted().forEach(function (j) { (jobsByDate[j.date] = jobsByDate[j.date] || []).push(j); });

    var todayS = todayStr();
    var cells = [];
    var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    for (var i = 0; i < totalCells; i++) {
      var dayNum, monthOffset = 0, muted = false;
      if (i < startOffset) { dayNum = prevDays - startOffset + i + 1; muted = true; monthOffset = -1; }
      else if (i >= startOffset + daysInMonth) { dayNum = i - startOffset - daysInMonth + 1; muted = true; monthOffset = 1; }
      else { dayNum = i - startOffset + 1; }

      var cellMonth = state.calMonth + monthOffset;
      var cellYear = state.calYear;
      if (cellMonth < 0) { cellMonth = 11; cellYear--; }
      if (cellMonth > 11) { cellMonth = 0; cellYear++; }
      var dateStr = cellYear + "-" + pad2(cellMonth + 1) + "-" + pad2(dayNum);

      var dayJobs = jobsByDate[dateStr] || [];
      var dots = dayJobs.slice(0, 4).map(function (j) {
        return '<span class="cal-dot ' + (j.status === "done" ? "done" : j.status === "cancelled" ? "cancelled" : "") + '"></span>';
      }).join("");
      var more = dayJobs.length > 4 ? '<span class="cal-more">+' + (dayJobs.length - 4) + '</span>' : "";

      var cls = "cal-cell" + (muted ? " muted" : "") + (dateStr === todayS ? " today" : "") + (dateStr === state.selectedDay ? " selected" : "");
      cells.push('<div class="' + cls + '" data-date="' + dateStr + '"><div class="cal-daynum">' + dayNum + '</div><div class="cal-dots">' + dots + more + '</div></div>');
    }
    document.getElementById("cal-grid").innerHTML = cells.join("");

    document.querySelectorAll(".cal-cell").forEach(function (el) {
      el.addEventListener("click", function () {
        var d = el.getAttribute("data-date");
        state.selectedDay = (state.selectedDay === d) ? null : d;
        renderCalendar();
        renderAgenda();
      });
    });
  }

  function renderAgenda() {
    var listEl = document.getElementById("agenda-list");
    var titleEl = document.getElementById("agenda-title");
    var jobs = jobsSorted().filter(function (j) { return j.status !== "cancelled"; });
    var items;
    if (state.selectedDay) {
      titleEl.textContent = fmtDateHuman(state.selectedDay) + " — завдання";
      items = jobs.filter(function (j) { return j.date === state.selectedDay; });
    } else {
      titleEl.textContent = "Найближчі завдання";
      var todayS = todayStr();
      items = jobs.filter(function (j) { return j.date >= todayS; }).slice(0, 8);
    }
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-note">Немає запланованих завдань' + (state.selectedDay ? " на цей день" : "") + '.</div>';
      return;
    }
    listEl.innerHTML = items.map(function (j) {
      return '<div class="agenda-item clickable" data-job="' + j.id + '" style="cursor:pointer;">' +
        '<div class="agenda-date">' + fmtDateHuman(j.date) + (j.time ? '<b>' + j.time + '</b>' : "") + '</div>' +
        '<div class="agenda-main"><div class="title">' + escapeHtml(clientName(j.clientId)) + '</div>' +
        '<div class="meta">' + escapeHtml(j.service || "") + (j.address ? " · " + escapeHtml(j.address) : "") + '</div></div>' +
        '<span class="pill ' + j.status + '"><span class="pill-dot"></span>' + statusLabelJob(j.status) + '</span></div>';
    }).join("");
    listEl.querySelectorAll("[data-job]").forEach(function (el) {
      el.addEventListener("click", function () { openJobModal(el.getAttribute("data-job")); });
    });
  }

  function renderReminders() {
    var el = document.getElementById("reminders-list");
    var todayS = todayStr();
    var soon = new Date(); soon.setDate(soon.getDate() + 2);
    var soonS = fmtDate(soon);
    var items = [];
    jobsSorted().forEach(function (j) {
      if (j.status === "scheduled" && j.date >= todayS && j.date <= soonS) {
        items.push({ date: j.date, label: escapeHtml(clientName(j.clientId)) + " — " + escapeHtml(j.service || "завдання"), tone: "accent" });
      }
    });
    invoicesList().forEach(function (i) {
      if (isOverdue(i)) items.push({ date: i.dueDate, label: "Прострочено: " + escapeHtml(clientName(i.clientId)) + " · " + fmtMoney(i.amount), tone: "danger" });
    });
    items.sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!items.length) { el.innerHTML = '<div class="empty-note">Нічого термінового — усе під контролем.</div>'; return; }
    el.innerHTML = items.map(function (it) {
      return '<div class="agenda-item"><div class="agenda-date">' + fmtDateHuman(it.date) + '</div>' +
        '<div class="agenda-main"><div class="title" style="color:' + (it.tone === "danger" ? "var(--danger)" : "var(--text)") + ';">' + it.label + '</div></div></div>';
    }).join("");
  }

  /* ============ render: clients ============ */
  function renderClients() {
    var tbody = document.getElementById("clients-tbody");
    var q = state.clientQuery.trim().toLowerCase();
    var list = clientsList().filter(function (c) {
      if (state.clientFilter !== "all" && c.status !== state.clientFilter) return false;
      if (!q) return true;
      return [c.name, c.phone, c.email, c.address].some(function (f) { return f && f.toLowerCase().indexOf(q) !== -1; });
    }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });

    document.getElementById("clients-empty").hidden = !!clientsList().length;
    document.querySelector("#view-clients .table-wrap").style.display = clientsList().length ? "" : "none";

    tbody.innerHTML = list.map(function (c) {
      var nj = nextJobForClient(c.id);
      return '<tr class="clickable" data-client="' + c.id + '">' +
        '<td><div class="cell-title">' + escapeHtml(c.name) + '</div>' + (c.address ? '<div class="cell-sub">' + escapeHtml(c.address) + '</div>' : '') + '</td>' +
        '<td><div>' + escapeHtml(c.phone || "—") + '</div><div class="cell-sub">' + escapeHtml(c.email || "") + '</div></td>' +
        '<td><span class="pill ' + c.status + '"><span class="pill-dot"></span>' + statusLabelClient(c.status) + '</span></td>' +
        '<td>' + (nj ? fmtDateHuman(nj.date) + (nj.time ? ", " + nj.time : "") : '<span class="cell-sub">—</span>') + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit-client="' + c.id + '" title="Редагувати"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div></td></tr>';
    }).join("");

    document.getElementById("nav-count-clients").textContent = state.clients.size || "";
    tbody.querySelectorAll("tr[data-client]").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-edit-client]")) return;
        openClientDrawer(row.getAttribute("data-client"));
      });
    });
    tbody.querySelectorAll("[data-edit-client]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) { ev.stopPropagation(); openClientModal(btn.getAttribute("data-edit-client")); });
    });
  }

  /* ============ render: invoices ============ */
  function renderInvoices() {
    var tbody = document.getElementById("invoices-tbody");
    var list = invoicesList().filter(function (i) {
      if (state.invoiceFilter === "all") return true;
      if (state.invoiceFilter === "overdue") return isOverdue(i);
      return i.status === state.invoiceFilter;
    }).sort(function (a, b) { return (b.issueDate || "").localeCompare(a.issueDate || ""); });

    var all = invoicesList();
    document.getElementById("inv-total").textContent = fmtMoney(all.reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0));
    document.getElementById("inv-unpaid").textContent = fmtMoney(all.filter(function (i) { return i.status === "unpaid"; }).reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0));
    document.getElementById("inv-paid").textContent = fmtMoney(all.filter(function (i) { return i.status === "paid"; }).reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0));

    document.getElementById("invoices-empty").hidden = !!all.length;
    document.querySelector("#view-invoices .table-wrap").style.display = all.length ? "" : "none";

    tbody.innerHTML = list.map(function (inv) {
      var overdue = isOverdue(inv);
      var statusClass = overdue ? "overdue" : inv.status;
      return '<tr>' +
        '<td class="cell-title">' + escapeHtml(clientName(inv.clientId)) + '</td>' +
        '<td>' + escapeHtml(inv.note || "—") + '</td>' +
        '<td class="num">' + fmtMoney(inv.amount) + '</td>' +
        '<td>' + fmtDateHuman(inv.dueDate) + '</td>' +
        '<td><span class="pill ' + statusClass + '"><span class="pill-dot"></span>' + statusLabelInvoice(inv) + '</span></td>' +
        '<td><div class="row-actions">' +
          (inv.status === "unpaid" ? '<button class="btn btn-sm" data-mark-paid="' + inv.id + '">Позначити оплаченим</button>' : '<button class="btn btn-sm btn-ghost" data-mark-unpaid="' + inv.id + '">Скасувати оплату</button>') +
          '<button class="icon-btn" data-del-invoice="' + inv.id + '" title="Видалити"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg></button></div></td></tr>';
    }).join("");

    document.getElementById("nav-count-invoices").textContent = all.filter(function (i) { return i.status === "unpaid"; }).length || "";

    tbody.querySelectorAll("[data-mark-paid]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        api("PATCH", "/api/invoices/" + btn.getAttribute("data-mark-paid"), { status: "paid" }).then(function () { toast("Рахунок позначено оплаченим"); loadAll(); });
      });
    });
    tbody.querySelectorAll("[data-mark-unpaid]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        api("PATCH", "/api/invoices/" + btn.getAttribute("data-mark-unpaid"), { status: "unpaid" }).then(function () { loadAll(); });
      });
    });
    tbody.querySelectorAll("[data-del-invoice]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Видалити цей рахунок?")) return;
        api("DELETE", "/api/invoices/" + btn.getAttribute("data-del-invoice")).then(function () { toast("Рахунок видалено"); loadAll(); });
      });
    });
  }

  /* ============ render: team (admin) ============ */
  function renderTeam() {
    if (!state.me || state.me.role !== "admin") return;
    var tbody = document.getElementById("users-tbody");
    tbody.innerHTML = state.users.map(function (u) {
      return '<tr>' +
        '<td class="cell-title">' + escapeHtml(u.name) + (u.id === state.me.id ? ' <span class="cell-sub">(ви)</span>' : '') + '</td>' +
        '<td class="mono">' + escapeHtml(u.username) + '</td>' +
        '<td><span class="pill ' + u.role + '"><span class="pill-dot"></span>' + (u.role === "admin" ? "адмін" : "співробітник") + '</span></td>' +
        '<td><span class="pill ' + (u.active ? "active" : "inactive") + '"><span class="pill-dot"></span>' + (u.active ? "активний" : "вимкнено") + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-sm" data-reset-pw="' + u.id + '">Скинути пароль</button>' +
          '<button class="btn btn-sm btn-ghost" data-toggle-active="' + u.id + '">' + (u.active ? "Вимкнути" : "Увімкнути") + '</button>' +
          (u.id === state.me.id ? '' : '<button class="icon-btn" data-del-user="' + u.id + '" title="Видалити"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg></button>') +
        '</div></td></tr>';
    }).join("");

    tbody.querySelectorAll("[data-reset-pw]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pw = prompt("Новий пароль для цього співробітника (мінімум 8 символів):");
        if (!pw) return;
        api("PATCH", "/api/users/" + btn.getAttribute("data-reset-pw"), { password: pw }).then(function () { toast("Пароль оновлено"); }).catch(function (err) { toast(err.message, true); });
      });
    });
    tbody.querySelectorAll("[data-toggle-active]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-toggle-active");
        var u = state.users.find(function (x) { return x.id === id; });
        api("PATCH", "/api/users/" + id, { active: !u.active }).then(function () { toast("Статус оновлено"); loadAll(); }).catch(function (err) { toast(err.message, true); });
      });
    });
    tbody.querySelectorAll("[data-del-user]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Видалити цей обліковий запис?")) return;
        api("DELETE", "/api/users/" + btn.getAttribute("data-del-user")).then(function () { toast("Акаунт видалено"); loadAll(); }).catch(function (err) { toast(err.message, true); });
      });
    });
  }

  /* ============ modals: client ============ */
  function clientOptionsHtml(selectedId) {
    return clientsList().sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); }).map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selectedId ? " selected" : "") + '>' + escapeHtml(c.name) + '</option>';
    }).join("");
  }

  function closeOverlay() { document.getElementById("modal-root").innerHTML = ""; }

  function openClientModal(id) {
    var c = id ? state.clients.get(id) : { name: "", phone: "", email: "", address: "", status: "lead", notes: "" };
    var root = document.getElementById("modal-root");
    root.innerHTML =
      '<div class="modal-backdrop" id="ov-backdrop"><div class="modal">' +
        '<div class="modal-head"><h3>' + (id ? "Редагувати клієнта" : "Новий клієнт") + '</h3>' +
          '<button class="icon-btn" id="ov-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label>Ім\'я / назва *</label><input type="text" id="f-name" value="' + escapeHtml(c.name) + '" placeholder="Напр. Анна Шмідт"></div>' +
          '<div class="field-row">' +
            '<div class="field"><label>Телефон</label><input type="tel" id="f-phone" value="' + escapeHtml(c.phone) + '" placeholder="+49 ..."></div>' +
            '<div class="field"><label>Email</label><input type="email" id="f-email" value="' + escapeHtml(c.email) + '"></div>' +
          '</div>' +
          '<div class="field"><label>Адреса</label><input type="text" id="f-address" value="' + escapeHtml(c.address) + '" placeholder="Вулиця, місто"></div>' +
          '<div class="field"><label>Статус</label><select id="f-status">' +
            ["lead", "active", "inactive"].map(function (s) { return '<option value="' + s + '"' + (c.status === s ? " selected" : "") + '>' + statusLabelClient(s) + '</option>'; }).join("") +
          '</select></div>' +
          '<div class="field"><label>Нотатки</label><textarea id="f-notes" placeholder="Особливості об\'єкта, домовленості...">' + escapeHtml(c.notes) + '</textarea></div>' +
        '</div>' +
        '<div class="modal-foot">' +
          (id ? '<button class="btn btn-danger-text" id="ov-delete">Видалити клієнта</button>' : '<span></span>') +
          '<button class="btn btn-primary" id="ov-save">Зберегти</button>' +
        '</div></div></div>';

    document.getElementById("ov-close").addEventListener("click", closeOverlay);
    document.getElementById("ov-backdrop").addEventListener("click", function (e) { if (e.target.id === "ov-backdrop") closeOverlay(); });
    document.getElementById("ov-save").addEventListener("click", function () {
      var name = document.getElementById("f-name").value.trim();
      if (!name) { toast("Вкажіть ім'я клієнта", true); return; }
      var data = {
        name: name,
        phone: document.getElementById("f-phone").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        address: document.getElementById("f-address").value.trim(),
        status: document.getElementById("f-status").value,
        notes: document.getElementById("f-notes").value.trim()
      };
      var req = id ? api("PATCH", "/api/clients/" + id, data) : api("POST", "/api/clients", data);
      req.then(function () { toast(id ? "Клієнта оновлено" : "Клієнта додано"); closeOverlay(); loadAll(); })
         .catch(function (err) { toast(err.message, true); });
    });
    if (id) {
      document.getElementById("ov-delete").addEventListener("click", function () {
        if (!confirm("Видалити клієнта \"" + c.name + "\"? Пов'язані завдання й рахунки залишаться в системі.")) return;
        api("DELETE", "/api/clients/" + id).then(function () { toast("Клієнта видалено"); closeOverlay(); loadAll(); });
      });
    }
  }

  function openClientDrawer(id) {
    var c = state.clients.get(id);
    if (!c) return;
    var root = document.getElementById("drawer-root");
    var history = jobsSorted().filter(function (j) { return j.clientId === id; }).reverse();
    var invs = invoicesList().filter(function (i) { return i.clientId === id; });

    root.innerHTML =
      '<div class="drawer-backdrop" id="dr-backdrop"></div><div class="drawer">' +
        '<div class="drawer-head"><div><h3>' + escapeHtml(c.name) + '</h3><span class="pill ' + c.status + '" style="margin-top:6px;"><span class="pill-dot"></span>' + statusLabelClient(c.status) + '</span></div>' +
          '<button class="icon-btn" id="dr-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="drawer-body">' +
          '<div class="drawer-section"><h4>Контакти</h4><div class="kv">' +
            '<div class="kv-row"><div class="k">Телефон</div><div class="v">' + escapeHtml(c.phone || "—") + '</div></div>' +
            '<div class="kv-row"><div class="k">Email</div><div class="v">' + escapeHtml(c.email || "—") + '</div></div>' +
            '<div class="kv-row"><div class="k">Адреса</div><div class="v">' + escapeHtml(c.address || "—") + '</div></div></div></div>' +
          (c.notes ? '<div class="drawer-section"><h4>Нотатки</h4><div style="font-size:13px;">' + escapeHtml(c.notes) + '</div></div>' : '') +
          '<div class="drawer-section"><h4 style="display:flex; justify-content:space-between; align-items:center;">Завдання <button class="btn btn-sm" id="dr-add-job">+ Додати</button></h4>' +
            (history.length ? history.map(function (j) {
              return '<div class="job-row"><div class="agenda-date">' + fmtDateHuman(j.date) + '</div><div class="agenda-main"><div class="title">' + escapeHtml(j.service || "") + '</div></div><span class="pill ' + j.status + '"><span class="pill-dot"></span>' + statusLabelJob(j.status) + '</span></div>';
            }).join("") : '<div class="empty-note">Ще немає завдань</div>') + '</div>' +
          '<div class="drawer-section"><h4 style="display:flex; justify-content:space-between; align-items:center;">Рахунки <button class="btn btn-sm" id="dr-add-invoice">+ Додати</button></h4>' +
            (invs.length ? invs.map(function (i) {
              return '<div class="job-row"><div class="agenda-main"><div class="title">' + fmtMoney(i.amount) + '</div><div class="meta">' + escapeHtml(i.note || "") + '</div></div><span class="pill ' + (isOverdue(i) ? "overdue" : i.status) + '"><span class="pill-dot"></span>' + statusLabelInvoice(i) + '</span></div>';
            }).join("") : '<div class="empty-note">Ще немає рахунків</div>') + '</div>' +
        '</div></div>';

    function close() { root.innerHTML = ""; }
    document.getElementById("dr-close").addEventListener("click", close);
    document.getElementById("dr-backdrop").addEventListener("click", close);
    document.getElementById("dr-add-job").addEventListener("click", function () { close(); openJobModal(null, { clientId: id }); });
    document.getElementById("dr-add-invoice").addEventListener("click", function () { close(); openInvoiceModal(null, { clientId: id }); });
  }

  /* ============ modals: job ============ */
  function openJobModal(id, presets) {
    presets = presets || {};
    if (!clientsList().length) { toast("Спершу додайте хоча б одного клієнта", true); return; }
    var j = id ? state.jobs.get(id) : {
      clientId: presets.clientId || (clientsList()[0] && clientsList()[0].id) || "",
      date: presets.date || state.selectedDay || todayStr(),
      time: "10:00", service: SERVICE_TYPES[0], address: "", price: "", status: "scheduled", notes: ""
    };
    var root = document.getElementById("modal-root");
    root.innerHTML =
      '<div class="modal-backdrop" id="ov-backdrop"><div class="modal">' +
        '<div class="modal-head"><h3>' + (id ? "Редагувати завдання" : "Нове завдання") + '</h3>' +
          '<button class="icon-btn" id="ov-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label>Клієнт *</label><select id="f-client">' + clientOptionsHtml(j.clientId) + '</select></div>' +
          '<div class="field-row">' +
            '<div class="field"><label>Дата *</label><input type="date" id="f-date" value="' + j.date + '"></div>' +
            '<div class="field"><label>Час</label><input type="time" id="f-time" value="' + (j.time || "") + '"></div></div>' +
          '<div class="field"><label>Тип послуги</label><select id="f-service">' +
            SERVICE_TYPES.map(function (s) { return '<option' + (j.service === s ? " selected" : "") + '>' + s + '</option>'; }).join("") + '</select></div>' +
          '<div class="field"><label>Адреса об\'єкта</label><input type="text" id="f-address" value="' + escapeHtml(j.address) + '"></div>' +
          '<div class="field-row">' +
            '<div class="field"><label>Вартість, €</label><input type="number" id="f-price" value="' + escapeHtml(j.price) + '" min="0" step="1"></div>' +
            '<div class="field"><label>Статус</label><select id="f-status">' +
              ["scheduled", "done", "cancelled"].map(function (s) { return '<option value="' + s + '"' + (j.status === s ? " selected" : "") + '>' + statusLabelJob(s) + '</option>'; }).join("") + '</select></div></div>' +
          '<div class="field"><label>Нотатки</label><textarea id="f-notes">' + escapeHtml(j.notes) + '</textarea></div>' +
        '</div>' +
        '<div class="modal-foot">' + (id ? '<button class="btn btn-danger-text" id="ov-delete">Видалити</button>' : '<span></span>') +
          '<button class="btn btn-primary" id="ov-save">Зберегти</button></div></div></div>';

    document.getElementById("ov-close").addEventListener("click", closeOverlay);
    document.getElementById("ov-backdrop").addEventListener("click", function (e) { if (e.target.id === "ov-backdrop") closeOverlay(); });
    document.getElementById("ov-save").addEventListener("click", function () {
      var date = document.getElementById("f-date").value;
      if (!date) { toast("Вкажіть дату", true); return; }
      var data = {
        clientId: document.getElementById("f-client").value,
        date: date,
        time: document.getElementById("f-time").value,
        service: document.getElementById("f-service").value,
        address: document.getElementById("f-address").value.trim(),
        price: document.getElementById("f-price").value ? Number(document.getElementById("f-price").value) : null,
        status: document.getElementById("f-status").value,
        notes: document.getElementById("f-notes").value.trim()
      };
      var req = id ? api("PATCH", "/api/jobs/" + id, data) : api("POST", "/api/jobs", data);
      req.then(function () { toast(id ? "Завдання оновлено" : "Завдання заплановано"); closeOverlay(); loadAll(); })
         .catch(function (err) { toast(err.message, true); });
    });
    if (id) {
      document.getElementById("ov-delete").addEventListener("click", function () {
        if (!confirm("Видалити це завдання?")) return;
        api("DELETE", "/api/jobs/" + id).then(function () { toast("Завдання видалено"); closeOverlay(); loadAll(); });
      });
    }
    document.getElementById("f-client").addEventListener("change", function (e) {
      var c = state.clients.get(e.target.value);
      if (c && c.address && !document.getElementById("f-address").value) document.getElementById("f-address").value = c.address;
    });
  }

  /* ============ modals: invoice ============ */
  function openInvoiceModal(id, presets) {
    presets = presets || {};
    if (!clientsList().length) { toast("Спершу додайте хоча б одного клієнта", true); return; }
    var i = id ? state.invoices.get(id) : {
      clientId: presets.clientId || (clientsList()[0] && clientsList()[0].id) || "",
      amount: "", issueDate: todayStr(), dueDate: todayStr(), status: "unpaid", note: ""
    };
    var root = document.getElementById("modal-root");
    root.innerHTML =
      '<div class="modal-backdrop" id="ov-backdrop"><div class="modal">' +
        '<div class="modal-head"><h3>' + (id ? "Редагувати рахунок" : "Новий рахунок") + '</h3>' +
          '<button class="icon-btn" id="ov-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label>Клієнт *</label><select id="f-client">' + clientOptionsHtml(i.clientId) + '</select></div>' +
          '<div class="field-row">' +
            '<div class="field"><label>Сума, € *</label><input type="number" id="f-amount" value="' + escapeHtml(i.amount) + '" min="0" step="1"></div>' +
            '<div class="field"><label>Статус</label><select id="f-status">' +
              ["unpaid", "paid"].map(function (s) { return '<option value="' + s + '"' + (i.status === s ? " selected" : "") + '>' + (s === "unpaid" ? "неоплачено" : "оплачено") + '</option>'; }).join("") + '</select></div></div>' +
          '<div class="field-row">' +
            '<div class="field"><label>Дата виставлення</label><input type="date" id="f-issue" value="' + i.issueDate + '"></div>' +
            '<div class="field"><label>Термін оплати</label><input type="date" id="f-due" value="' + i.dueDate + '"></div></div>' +
          '<div class="field"><label>Опис</label><input type="text" id="f-note" value="' + escapeHtml(i.note) + '" placeholder="Напр. Генеральне прибирання, вул. ..."></div>' +
        '</div>' +
        '<div class="modal-foot">' + (id ? '<button class="btn btn-danger-text" id="ov-delete">Видалити</button>' : '<span></span>') +
          '<button class="btn btn-primary" id="ov-save">Зберегти</button></div></div></div>';

    document.getElementById("ov-close").addEventListener("click", closeOverlay);
    document.getElementById("ov-backdrop").addEventListener("click", function (e) { if (e.target.id === "ov-backdrop") closeOverlay(); });
    document.getElementById("ov-save").addEventListener("click", function () {
      var amount = Number(document.getElementById("f-amount").value);
      if (!amount) { toast("Вкажіть суму", true); return; }
      var data = {
        clientId: document.getElementById("f-client").value,
        amount: amount,
        issueDate: document.getElementById("f-issue").value,
        dueDate: document.getElementById("f-due").value,
        status: document.getElementById("f-status").value,
        note: document.getElementById("f-note").value.trim()
      };
      var req = id ? api("PATCH", "/api/invoices/" + id, data) : api("POST", "/api/invoices", data);
      req.then(function () { toast(id ? "Рахунок оновлено" : "Рахунок створено"); closeOverlay(); loadAll(); })
         .catch(function (err) { toast(err.message, true); });
    });
    if (id) {
      document.getElementById("ov-delete").addEventListener("click", function () {
        if (!confirm("Видалити цей рахунок?")) return;
        api("DELETE", "/api/invoices/" + id).then(function () { toast("Рахунок видалено"); closeOverlay(); loadAll(); });
      });
    }
  }

  /* ============ modal: new employee ============ */
  function openUserModal() {
    var root = document.getElementById("modal-root");
    root.innerHTML =
      '<div class="modal-backdrop" id="ov-backdrop"><div class="modal">' +
        '<div class="modal-head"><h3>Новий співробітник</h3>' +
          '<button class="icon-btn" id="ov-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label>Ім\'я</label><input type="text" id="f-name" placeholder="Напр. Марія"></div>' +
          '<div class="field"><label>Логін *</label><input type="text" id="f-username" placeholder="maria"></div>' +
          '<div class="field"><label>Пароль *</label><input type="password" id="f-password" placeholder="Мінімум 8 символів"></div>' +
          '<div class="field"><label>Роль</label><select id="f-role"><option value="employee">Співробітник</option><option value="admin">Адміністратор</option></select></div>' +
        '</div>' +
        '<div class="modal-foot"><span></span><button class="btn btn-primary" id="ov-save">Створити</button></div></div></div>';

    document.getElementById("ov-close").addEventListener("click", closeOverlay);
    document.getElementById("ov-backdrop").addEventListener("click", function (e) { if (e.target.id === "ov-backdrop") closeOverlay(); });
    document.getElementById("ov-save").addEventListener("click", function () {
      var data = {
        name: document.getElementById("f-name").value.trim(),
        username: document.getElementById("f-username").value.trim(),
        password: document.getElementById("f-password").value,
        role: document.getElementById("f-role").value
      };
      if (!data.username || !data.password) { toast("Заповніть логін і пароль", true); return; }
      api("POST", "/api/users", data).then(function () { toast("Співробітника додано"); closeOverlay(); loadAll(); })
        .catch(function (err) { toast(err.message, true); });
    });
  }

  /* ============ master render ============ */
  function render() {
    if (!state.me) return;
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "clients") renderClients();
    if (state.view === "invoices") renderInvoices();
    if (state.view === "team") renderTeam();
    document.getElementById("nav-count-clients").textContent = state.clients.size || "";
    document.getElementById("nav-count-invoices").textContent = invoicesList().filter(function (i) { return i.status === "unpaid"; }).length || "";
  }

  /* ============ static wiring ============ */
  document.querySelectorAll(".nav-item").forEach(function (el) {
    el.addEventListener("click", function () { setView(el.getAttribute("data-view")); });
  });
  document.getElementById("btn-new-client").addEventListener("click", function () { openClientModal(null); });
  document.getElementById("btn-new-client-dash").addEventListener("click", function () { openClientModal(null); });
  document.getElementById("btn-new-job-dash").addEventListener("click", function () { openJobModal(null); });
  document.getElementById("btn-new-invoice").addEventListener("click", function () { openInvoiceModal(null); });
  document.getElementById("btn-new-user").addEventListener("click", function () { openUserModal(); });

  document.getElementById("cal-prev").addEventListener("click", function () {
    state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", function () {
    state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  });

  document.getElementById("client-search").addEventListener("input", function (e) { state.clientQuery = e.target.value; renderClients(); });
  document.querySelectorAll("#view-clients .filter-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll("#view-clients .filter-chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      state.clientFilter = chip.getAttribute("data-status");
      renderClients();
    });
  });
  document.querySelectorAll("#view-invoices .filter-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll("#view-invoices .filter-chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      state.invoiceFilter = chip.getAttribute("data-inv-status");
      renderInvoices();
    });
  });

  boot();
})();

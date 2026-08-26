const API = "/api";
let token = sessionStorage.getItem("dv_token");
let user = JSON.parse(sessionStorage.getItem("dv_user") || "null");
let page = "home";

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error("Сессия истекла"); }
  if (!res.ok) {
    const d = data.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map(x => x.msg).join("; ") : "Ошибка");
  }
  return data;
}

function toast(msg, err = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (err ? " err" : "");
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

function logout() {
  token = null; user = null;
  sessionStorage.clear();
  show("login");
}

function show(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  if (name === "app") render();
}

document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-err");
  err.classList.add("hidden");
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: document.getElementById("login-id").value.trim(),
        password: document.getElementById("login-pass").value,
      }),
    });
    token = data.access_token;
    user = data.user;
    sessionStorage.setItem("dv_token", token);
    sessionStorage.setItem("dv_user", JSON.stringify(user));
    page = "home";
    show("app");
    startSignalPoll();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
};
document.getElementById("btn-logout").onclick = logout;

function navItems() {
  if (user.role === "admin") {
    return [
      ["home", "Главная"], ["orders", "Заказы"], ["board", "Сборка"], ["bags", "Сумки"],
      ["employees", "Сотрудники"], ["cells", "Ячейки"], ["points", "Точки"],
      ["missing", "Пропажи"], ["receive", "Приёмка"], ["eans", "EAN"],
    ];
  }
  if (user.role === "warehouse") {
    return [
      ["home", "Главная"], ["assemble", "Сборка"], ["issue", "Выдача"],
      ["returnbag", "Возврат"], ["unpack", "Разбор"], ["receive", "Приёмка"], ["board", "Очередь"],
    ];
  }
  return [["home", "Мои заказы"], ["profile", "Профиль"]];
}

function render() {
  document.getElementById("user-label").textContent = `${user.full_name} · ${user.role_label || user.role}`;
  const nav = document.getElementById("nav");
  const items = navItems();
  if (!items.find(i => i[0] === page)) page = items[0][0];
  nav.innerHTML = items.map(([id, label]) =>
    `<button class="${page === id ? "active" : ""}" data-p="${id}">${label}</button>`
  ).join("");
  nav.querySelectorAll("button").forEach(b => {
    b.onclick = () => { page = b.dataset.p; render(); };
  });
  const c = document.getElementById("content");
  c.innerHTML = "<p style='color:var(--muted)'>Загрузка...</p>";
  Promise.resolve(renderPage()).then(html => { c.innerHTML = html; afterRender(); })
    .catch(e => { c.innerHTML = `<div class="error">${e.message}</div>`; });
}

async function renderPage() {
  switch (page) {
    case "home": return renderHome();
    case "assemble": return renderAssemble();
    case "issue": return renderIssue();
    case "unpack": return renderUnpack();
    case "receive": return renderReceive();
    case "board": return renderBoard();
    case "bags": return renderBags();
    case "employees": return renderEmployees();
    case "cells": return renderCells();
    case "missing": return renderMissing();
    case "eans": return renderEans();
    case "orders": return renderOrdersAdmin();
    case "points": return renderPoints();
    case "returnbag": return renderReturnBag();
    case "profile": return `<div class="card"><p><b>${user.id}</b></p><p>${user.full_name}</p><p>${user.role_label}</p></div>`;
    default: return "<p>Раздел</p>";
  }
}

function afterRender() {
  // focus scan inputs
  const inp = document.querySelector(".scan-box input");
  if (inp) inp.focus();
}

async function renderHome() {
  if (user.role === "warehouse" || user.role === "admin") {
    return `
      <div class="page-h"><h1>Склад</h1></div>
      <div id="signal-banner" class="card" style="border-color:var(--warning);color:var(--warning);display:none"></div>
      <div class="tsd-grid">
        <button class="btn btn-primary btn-lg" onclick="page='assemble';render()">СБОРКА ОБОРУДОВАНИЯ</button>
        <button class="btn btn-accent btn-lg" onclick="page='issue';render()">ВЫДАЧА ИСПОЛНИТЕЛЮ</button>
        <button class="btn btn-lg" style="background:#3d2e10;color:var(--warning)" onclick="page='returnbag';render()">ВОЗВРАТ СУМКИ</button>
        <button class="btn btn-lg" style="background:#334d40;color:var(--primary)" onclick="page='unpack';render()">РАЗБОР СУМКИ</button>
        <button class="btn btn-lg" style="background:#1e2e26;color:var(--accent);border:1px solid var(--border)" onclick="page='receive';render()">ПРИЁМКА</button>
        ${user.role === "admin" ? `<button class="btn btn-ghost btn-lg" onclick="page='cells';render()">ЯЧЕЙКИ</button>` : ""}
      </div>`;
  }
  const orders = await api("/orders");
  return `<div class="page-h"><h1>Мои заказы</h1></div>
    ${orders.map(o => `<div class="card"><b>${o.id}</b> · ${o.status}<br>${o.address}</div>`).join("") || "<p style='color:var(--muted)'>Нет заказов</p>"}`;
}

/* ===== ASSEMBLY ===== */
let asm = { step: 1, orderId: null, bagId: null, items: [] };

async function renderAssemble() {
  asm = { step: 1, orderId: null, bagId: null, items: [] };
  const board = await api("/assembly/board");
  const waiting = board.filter(b => b.status === "awaiting_assembly" || b.status === "assembling");
  return `
    <div class="page-h">
      <h1>Сборка</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button>
    </div>
    <div id="asm-area">
      <p style="color:var(--muted);margin-bottom:0.75rem">Выберите заказ, затем сканируйте сумку (sumka + 5 цифр)</p>
      ${waiting.map(o => `
        <div class="card" style="cursor:pointer" onclick="asmPickOrder('${o.order_id}')">
          <div style="display:flex;justify-content:space-between">
            <b>Заказ ${o.order_id}</b>
            <span class="status status-warn">${o.status_label}</span>
          </div>
          <div style="margin-top:0.4rem;font-size:0.9rem">${o.address || ""}</div>
          <div class="cutoff ${o.cutoff_left != null && o.cutoff_left <= 5 ? "urgent" : ""}">
            Cut off: ${o.cutoff_left != null ? o.cutoff_left + " мин" : (o.cutoff_minutes || 10) + " мин"}
          </div>
        </div>`).join("") || "<p style='color:var(--muted)'>Нет заказов в очереди</p>"}
    </div>`;
}

window.asmPickOrder = (orderId) => {
  asm.orderId = orderId;
  asm.step = 2;
  document.getElementById("asm-area").innerHTML = `
    <div class="scan-info"><b>Заказ ${orderId}</b><br>Отсканируйте сумку</div>
    <div class="scan-box">
      <div>Код сумки (sumkaXXXXX)</div>
      <input id="scan-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')asmStart()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="asmStart()">Далее</button>
    </div>`;
  document.getElementById("scan-bag").focus();
};

window.asmStart = async () => {
  const code = document.getElementById("scan-bag").value.trim();
  try {
    const r = await api("/assembly/start", {
      method: "POST", body: JSON.stringify({ bag_id: code, order_id: asm.orderId }),
    });
    asm.bagId = r.bag_id;
    asm.step = 3;
    toast(r.message);
    document.getElementById("asm-area").innerHTML = `
      <div class="scan-info">
        <b>Сумка ${r.bag_id}</b> · Заказ ${r.order_id}<br>
        ${r.address || ""}<br>
        <span class="cutoff">Cut off: ${r.cutoff_minutes} мин</span>
      </div>
      <div class="scan-box">
        <div>Сканируйте оборудование (dd + 8 цифр)</div>
        <input id="scan-eq" placeholder="dd10000001" onkeydown="if(event.key==='Enter')asmAdd()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="asmAdd()">Добавить</button>
      </div>
      <ul class="item-list" id="asm-items"></ul>
      <div class="scan-box">
        <div>Точка передачи (TP01 / TP02…)</div>
        <input id="scan-tp" placeholder="TP01" list="tp-list" />
        <datalist id="tp-list"></datalist>
        <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="asmFinish()">Завершить сборку</button>
      </div>`;
    loadTpList();
    document.getElementById("scan-eq").focus();
  } catch (e) { toast(e.message, true); }
};

window.asmAdd = async () => {
  const code = document.getElementById("scan-eq").value.trim();
  try {
    const r = await api("/assembly/add-item", {
      method: "POST", body: JSON.stringify({ bag_id: asm.bagId, equipment_id: code }),
    });
    document.getElementById("asm-items").innerHTML = r.items.map(i =>
      `<li><span>${i.name}</span><code>${i.id}</code></li>`).join("");
    document.getElementById("scan-eq").value = "";
    document.getElementById("scan-eq").focus();
    toast("Добавлено: " + r.name);
  } catch (e) { toast(e.message, true); }
};

window.asmFinish = async () => {
  const tp = document.getElementById("scan-tp").value.trim();
  try {
    const r = await api("/assembly/finish", {
      method: "POST", body: JSON.stringify({ bag_id: asm.bagId, transfer_point: tp }),
    });
    toast(r.message);
    page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

/* ===== ISSUE ===== */
let iss = {};
async function renderIssue() {
  iss = {};
  return `
    <div class="page-h"><h1>Выдача исполнителю</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="iss-area">
      <div class="scan-box">
        <div>1. QR учётной записи исполнителя (usXXXXXX)</div>
        <input id="iss-user" placeholder="us000003" onkeydown="if(event.key==='Enter')issUser()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="issUser()">Далее</button>
      </div>
    </div>`;
}
window.issUser = () => {
  iss.executor = document.getElementById("iss-user").value.trim();
  document.getElementById("iss-area").innerHTML = `
    <div class="scan-info">Исполнитель: <b>${iss.executor}</b></div>
    <div class="scan-box">
      <div>2. Сумка (sumkaXXXXX)</div>
      <input id="iss-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')issGo()" />
      <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="issGo()">Выдать</button>
    </div>`;
  document.getElementById("iss-bag").focus();
};
window.issGo = async () => {
  try {
    const r = await api("/issue", {
      method: "POST",
      body: JSON.stringify({ executor_id: iss.executor, bag_id: document.getElementById("iss-bag").value.trim() }),
    });
    toast(r.message);
    page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

/* ===== UNPACK ===== */
let unp = {};
async function renderUnpack() {
  unp = {};
  return `
    <div class="page-h"><h1>Разбор сумки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="unp-area">
      <div class="scan-box">
        <div>Сканируйте сумку</div>
        <input id="unp-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')unpStart()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="unpStart()">Начать разбор</button>
      </div>
    </div>`;
}
window.unpStart = async () => {
  const code = document.getElementById("unp-bag").value.trim();
  try {
    const r = await api("/unpack/start", { method: "POST", body: JSON.stringify({ code }) });
    unp.bagId = r.bag_id;
    unp.expected = r.expected || [];
    showUnpackUI();
    toast(r.message);
  } catch (e) { toast(e.message, true); }
};
function showUnpackUI() {
  document.getElementById("unp-area").innerHTML = `
    <div class="scan-info"><b>Сумка ${unp.bagId}</b>
      <ul class="item-list">${unp.expected.map(e => `<li>${e.name} <code>${e.id}</code></li>`).join("") || "<li>пусто</li>"}</ul>
    </div>
    <div class="scan-box">
      <div>Оборудование (dd…)</div>
      <input id="unp-eq" placeholder="dd10000001" />
      <div style="margin-top:0.75rem">Ячейка (DY…)</div>
      <input id="unp-cell" placeholder="DY0010661/2" onkeydown="if(event.key==='Enter')unpItem()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="unpItem()">Разместить</button>
    </div>
    <button class="btn btn-danger btn-block" style="margin-top:0.5rem" onclick="unpDamage()">Зафиксировать повреждение</button>
    <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="unpEmpty()">Оборудование размещено</button>
    <div id="unp-extra"></div>`;
}
window.unpItem = async () => {
  try {
    const r = await api("/unpack/item", {
      method: "POST",
      body: JSON.stringify({
        bag_id: unp.bagId,
        equipment_id: document.getElementById("unp-eq").value.trim(),
        cell_code: document.getElementById("unp-cell").value.trim(),
      }),
    });
    toast(r.message);
    unp.expected = r.remaining_items || [];
    if (r.bag_empty) {
      document.getElementById("unp-area").innerHTML = `
        <div class="scan-info"><b>Сумка разобрана</b></div>
        <button class="btn btn-primary btn-lg" onclick="page='home';render()">На главный экран</button>`;
    } else {
      showUnpackUI();
      document.getElementById("unp-eq").value = "";
      document.getElementById("unp-cell").value = "";
    }
  } catch (e) { toast(e.message, true); }
};
window.unpDamage = async () => {
  const eq = prompt("Код оборудования (dd…):");
  if (!eq) return;
  const zone = prompt("QR зоны повреждённого:", "PROBLEMNOE_OBORUDOVANIE");
  try {
    const r = await api("/unpack/damage", {
      method: "POST",
      body: JSON.stringify({ bag_id: unp.bagId, equipment_id: eq, zone_code: zone || "PROBLEMNOE_OBORUDOVANIE" }),
    });
    toast(r.message);
  } catch (e) { toast(e.message, true); }
};
window.unpEmpty = async () => {
  try {
    const r = await api("/unpack/declare-empty", { method: "POST", body: JSON.stringify({ code: unp.bagId }) });
    const box = document.getElementById("unp-extra");
    if (!r.has_missing) {
      toast("Недостач нет");
      return;
    }
    box.innerHTML = `
      <div class="card" style="margin-top:1rem">
        <b>Не хватает:</b>
        <ul class="item-list">${r.missing.map(m => `<li>${m.name} <code>${m.id}</code></li>`).join("")}</ul>
        <button class="btn btn-danger btn-block" onclick="unpInvest()">Сумка пуста, запустить расследование</button>
      </div>`;
  } catch (e) { toast(e.message, true); }
};
window.unpInvest = async () => {
  try {
    const r = await api("/unpack/start-investigation", { method: "POST", body: JSON.stringify({ code: unp.bagId }) });
    toast(r.message);
    page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

/* ===== RECEIVE ===== */
let rcv = {};
async function renderReceive() {
  rcv = {};
  return `
    <div class="page-h"><h1>Приёмка</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="rcv-area">
      <div class="scan-box">
        <div>1. EAN производителя</div>
        <input id="rcv-ean" placeholder="4601234567890" />
        <div style="margin-top:0.75rem">2. Код единицы (dd + 8 цифр)</div>
        <input id="rcv-eq" placeholder="dd20000001" onkeydown="if(event.key==='Enter')rcvAccept()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="rcvAccept()">Принято</button>
      </div>
    </div>`;
}
window.rcvAccept = async () => {
  try {
    const r = await api("/receive", {
      method: "POST",
      body: JSON.stringify({
        ean: document.getElementById("rcv-ean").value.trim(),
        equipment_id: document.getElementById("rcv-eq").value.trim(),
      }),
    });
    rcv.eqId = r.equipment_id;
    toast(r.message);
    document.getElementById("rcv-area").innerHTML = `
      <div class="scan-info">${r.name} · <code>${r.equipment_id}</code></div>
      <div class="scan-box">
        <div>Ячейка для размещения</div>
        <input id="rcv-cell" placeholder="DY0010661/2" onkeydown="if(event.key==='Enter')rcvPlace()" />
        <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="rcvPlace()">Разместить</button>
      </div>`;
    document.getElementById("rcv-cell").focus();
  } catch (e) { toast(e.message, true); }
};
window.rcvPlace = async () => {
  try {
    const r = await api("/receive/place", {
      method: "POST",
      body: JSON.stringify({ equipment_id: rcv.eqId, cell_code: document.getElementById("rcv-cell").value.trim() }),
    });
    toast(r.message);
    page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

/* ===== ADMIN VIEWS ===== */
async function renderBoard() {
  const rows = await api("/assembly/board");
  return `
    <div class="page-h"><h1>Сбор оборудования</h1></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Заказ</th><th>Статус</th><th>Cut off</th><th>Адрес</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>№${r.order_id}</td>
          <td><span class="status status-warn">${r.status_label}</span></td>
          <td class="cutoff ${r.cutoff_left != null && r.cutoff_left <= 5 ? "urgent" : ""}">${r.cutoff_left != null ? r.cutoff_left + " мин" : "—"}</td>
          <td>${r.address || ""}</td>
        </tr>`).join("") || "<tr><td colspan=4>Пусто</td></tr>"}
      </tbody></table></div>`;
}

async function renderBags() {
  const rows = await api("/bags");
  return `
    <div class="page-h"><h1>Сумки</h1></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Сумка</th><th>Статус</th><th>Заказ</th><th>Исполнитель</th></tr></thead>
      <tbody>${rows.map(b => `
        <tr>
          <td><code>${b.id}</code></td>
          <td>${b.status_label}</td>
          <td>${b.order_id || "—"}</td>
          <td>${b.executor_id || "—"}</td>
        </tr>`).join("")}
      </tbody></table></div>`;
}

async function renderEmployees() {
  const list = await api("/employees");
  const next = await api("/employees/next-id");
  return `
    <div class="page-h"><h1>Сотрудники</h1></div>
    <div class="card">
      <div class="card-title">Быстрое добавление</div>
      <label>Учётная запись (свободна)</label>
      <input id="emp-id" value="${next.id}" readonly />
      <label>ФИО</label>
      <input id="emp-name" placeholder="Иванов Иван Иванович" />
      <label>Дата рождения</label>
      <input id="emp-bd" type="date" />
      <label>Роль</label>
      <select id="emp-role">
        <option value="warehouse">Сотрудник склада</option>
        <option value="cleaner">Клинер</option>
        <option value="handyman">Мастер на все руки</option>
      </select>
      <button class="btn btn-primary btn-block" onclick="empSave()">Сохранить</button>
    </div>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>ID</th><th>ФИО</th><th>Роль</th><th>Статус</th></tr></thead>
      <tbody>${list.map(u => `<tr><td>${u.id}</td><td>${u.full_name}</td><td>${u.role_label}</td><td>${u.status}</td></tr>`).join("")}
      </tbody></table></div>`;
}
window.empSave = async () => {
  try {
    const r = await api("/employees", {
      method: "POST",
      body: JSON.stringify({
        full_name: document.getElementById("emp-name").value.trim(),
        birth_date: document.getElementById("emp-bd").value || null,
        role: document.getElementById("emp-role").value,
      }),
    });
    toast(`Создан ${r.id}, пароль: ${r.password}`);
    render();
  } catch (e) { toast(e.message, true); }
};

async function renderCells() {
  const list = await api("/cells");
  return `
    <div class="page-h"><h1>Ячейки</h1></div>
    ${user.role === "admin" ? `
    <div class="card">
      <label>Код ячейки</label>
      <input id="cell-code" placeholder="DY0010661/2" />
      <button class="btn btn-primary btn-block" onclick="cellAdd()">Добавить</button>
    </div>` : ""}
    <div class="table-wrap"><table>
      <thead><tr><th>Код</th><th>Склад</th><th>Регион</th><th>Полка</th><th>Ячейка</th></tr></thead>
      <tbody>${list.map(c => `<tr><td>${c.code}</td><td>${c.warehouse_no}</td><td>${c.region}</td><td>${c.shelf}</td><td>${c.slot}</td></tr>`).join("")}
      </tbody></table></div>`;
}
window.cellAdd = async () => {
  try {
    const r = await api("/cells", { method: "POST", body: JSON.stringify({ code: document.getElementById("cell-code").value.trim() }) });
    toast("Ячейка " + r.code);
    render();
  } catch (e) { toast(e.message, true); }
};

async function renderMissing() {
  const rows = await api("/missing");
  return `
    <div class="page-h"><h1>Пропажи</h1></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Оборудование</th><th>Сумка</th><th>Последние 2 пользователя</th><th>Кто сообщил</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${r.name}<br><code>${r.equipment_id}</code></td>
          <td>${r.bag_id || "—"}</td>
          <td>${r.last_user_1 || "—"} / ${r.last_user_2 || "—"}</td>
          <td>${r.reported_by}</td>
        </tr>`).join("") || "<tr><td colspan=4>Нет открытых пропаж</td></tr>"}
      </tbody></table></div>`;
}

async function renderEans() {
  const list = await api("/equipment-types");
  return `
    <div class="page-h"><h1>EAN (типы)</h1></div>
    <div class="card">
      <label>EAN</label><input id="ean-code" placeholder="4601234567890" />
      <label>Название</label><input id="ean-name" placeholder="Пылесос Karcher" />
      <button class="btn btn-primary btn-block" onclick="eanAdd()">Добавить</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>EAN</th><th>Название</th></tr></thead>
      <tbody>${list.map(t => `<tr><td>${t.ean}</td><td>${t.name}</td></tr>`).join("")}
      </tbody></table></div>`;
}
window.eanAdd = async () => {
  try {
    await api("/equipment-types", {
      method: "POST",
      body: JSON.stringify({ ean: document.getElementById("ean-code").value.trim(), name: document.getElementById("ean-name").value.trim() }),
    });
    toast("EAN добавлен");
    render();
  } catch (e) { toast(e.message, true); }
};

if (token && user) {
  api("/me").then(u => { user = u; sessionStorage.setItem("dv_user", JSON.stringify(u)); show("app"); startSignalPoll(); }).catch(logout);
} else {
  show("login");
}


window.loadTpList = async () => {
  try {
    const list = await api("/transfer-points");
    const dl = document.getElementById("tp-list");
    if (dl) dl.innerHTML = list.map(p => `<option value="${p.code}">${p.name}</option>`).join("");
  } catch (_) {}
};

async function renderOrdersAdmin() {
  const orders = await api("/orders");
  const emps = (await api("/employees")).filter(e => e.role === "cleaner" || e.role === "handyman");
  return `
    <div class="page-h"><h1>Заказы</h1></div>
    <div class="card">
      <div class="card-title">Новый заказ → на сборку</div>
      <label>Клиент</label>
      <input id="ord-client" placeholder="ООО Ромашка" />
      <label>Адрес объекта *</label>
      <input id="ord-addr" placeholder="г. Москва, ул. …" />
      <label>Тип уборки</label>
      <input id="ord-type" placeholder="Генеральная / Поддерживающая" />
      <label>Исполнитель</label>
      <select id="ord-exec">
        <option value="">— не назначен —</option>
        ${emps.map(e => `<option value="${e.id}">${e.full_name} (${e.id})</option>`).join("")}
      </select>
      <label>Cut off (мин)</label>
      <select id="ord-cut">
        <option value="10">10</option>
        <option value="15">15</option>
        <option value="20">20</option>
        <option value="30">30</option>
      </select>
      <button class="btn btn-primary btn-block" onclick="ordCreate(true)">Создать и на сборку</button>
      <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="ordCreate(false)">Только создать</button>
    </div>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>Заказ</th><th>Адрес</th><th>Статус</th><th>Cut off</th><th></th></tr></thead>
      <tbody>${orders.map(o => `
        <tr>
          <td>${o.id}</td>
          <td>${o.address}</td>
          <td>${o.status}</td>
          <td>${o.cutoff_minutes} мин</td>
          <td>${o.status === "new" ? `<button class="btn btn-primary btn-sm" onclick="ordSend('${o.id}')">На сборку</button>` : ""}</td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.ordCreate = async (send) => {
  try {
    const r = await api("/orders", {
      method: "POST",
      body: JSON.stringify({
        client_name: document.getElementById("ord-client").value.trim() || null,
        address: document.getElementById("ord-addr").value.trim(),
        cleaning_type: document.getElementById("ord-type").value.trim() || null,
        executor_id: document.getElementById("ord-exec").value || null,
        cutoff_minutes: parseInt(document.getElementById("ord-cut").value, 10),
        send_to_assembly: send,
      }),
    });
    toast(r.message);
    if (r.signal) playBeep();
    render();
  } catch (e) { toast(e.message, true); }
};
window.ordSend = async (id) => {
  try {
    const r = await api("/orders/" + id + "/send-to-assembly", { method: "POST" });
    toast(r.message);
    playBeep();
    render();
  } catch (e) { toast(e.message, true); }
};

async function renderPoints() {
  const list = await api("/transfer-points");
  return `
    <div class="page-h"><h1>Точки передачи</h1></div>
    <div class="card">
      <label>Код (TP01)</label>
      <input id="tp-code" placeholder="TP04" />
      <label>Название</label>
      <input id="tp-name" placeholder="У лифта / Стеллаж 5" />
      <button class="btn btn-primary btn-block" onclick="tpAdd()">Добавить</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Код</th><th>Название</th></tr></thead>
      <tbody>${list.map(p => `<tr><td><code>${p.code}</code></td><td>${p.name}</td></tr>`).join("")}
      </tbody></table></div>`;
}
window.tpAdd = async () => {
  try {
    await api("/transfer-points", {
      method: "POST",
      body: JSON.stringify({
        code: document.getElementById("tp-code").value.trim(),
        name: document.getElementById("tp-name").value.trim(),
      }),
    });
    toast("Точка добавлена");
    render();
  } catch (e) { toast(e.message, true); }
};

async function renderReturnBag() {
  return `
    <div class="page-h"><h1>Возврат сумки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div class="scan-box">
      <div>Сканируйте сумку от исполнителя</div>
      <input id="ret-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')doReturnBag()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="doReturnBag()">Принять на разбор</button>
    </div>`;
}
window.doReturnBag = async () => {
  try {
    const r = await api("/bags/return", {
      method: "POST",
      body: JSON.stringify({ bag_id: document.getElementById("ret-bag").value.trim() }),
    });
    toast(r.message);
    page = "unpack";
    render();
  } catch (e) { toast(e.message, true); }
};

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 200);
    setTimeout(() => {
      const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
      const o2 = ctx2.createOscillator();
      const g2 = ctx2.createGain();
      o2.connect(g2); g2.connect(ctx2.destination);
      o2.frequency.value = 1200;
      g2.gain.value = 0.15;
      o2.start();
      setTimeout(() => { o2.stop(); ctx2.close(); }, 250);
    }, 250);
  } catch (_) {}
}

// Poll signals on warehouse home
let signalTimer = null;
function startSignalPoll() {
  if (signalTimer) clearInterval(signalTimer);
  if (!user || (user.role !== "warehouse" && user.role !== "admin")) return;
  let known = new Set();
  signalTimer = setInterval(async () => {
    try {
      const sigs = await api("/tsd/signals");
      for (const s of sigs) {
        if (!known.has(s.order_id)) {
          known.add(s.order_id);
          playBeep();
          if (page === "home" || page === "board" || page === "assemble") {
            const el = document.getElementById("signal-banner");
            if (el) {
              el.style.display = "block";
              el.textContent = `🔔 Новый заказ на сборку: ${s.order_id}`;
            }
          }
        }
      }
    } catch (_) {}
  }, 8000);
}


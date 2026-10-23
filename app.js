const API = "/api";
let token = sessionStorage.getItem("dv_token");
let user = JSON.parse(sessionStorage.getItem("dv_user") || "null");
let page = "home";
let warehouseCode = sessionStorage.getItem("dv_wh") || "001066";
function setWarehouse(code) {
  warehouseCode = code;
  sessionStorage.setItem("dv_wh", code);
}


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
  if (err) playErrorBeep();
}
function playErrorBeep() {
  try {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "square"; o.frequency.value = 220; g.gain.value = 0.12;
    o.start();
    setTimeout(() => { o.frequency.value = 160; }, 100);
    setTimeout(() => { o.stop(); ctx.close(); }, 280);
  } catch (_) {}
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
    // refresh full me
    try { user = await api("/me"); sessionStorage.setItem("dv_user", JSON.stringify(user)); } catch(_) {}
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
      ["home", "Главная"], ["lookup", "Объект"], ["orders", "Заказы"], ["orderHistory", "История"],
      ["shift", "Смена"], ["logistics", "Логистика"],
      ["employees", "Сотрудники"], ["warehouses", "Склады"], ["missing", "Пропажи"],
      ["settings", "Настройки"], ["qr", "QR"], ["profile", "Профиль"],
    ];
  }
  if (user.role === "supervisor" || user.role === "warehouse") {
    // старший смены = склад + назначение исполнителей в заказах
    return [
      ["home", "Главная"], ["lookup", "Объект"], ["orders", "Заказы"],
      ["logistics", "Логистика"], ["board", "Очередь"],
      ["shift", "Смена"], ["missing", "Пропажи"], ["profile", "Профиль"],
    ];
  }
  if (user.role === "order_manager") {
    return [
      ["orders", "Заказы"], ["orderHistory", "История"], ["profile", "Профиль"],
    ];
  }
  return [["home", "Мои заказы"], ["orderHistory", "История заказов"], ["profile", "Профиль"]];
}

function render() {
  document.getElementById("user-label").textContent = `${user.full_name} · ${user.role_label || user.role}`;
  const nav = document.getElementById("nav");
  const items = navItems();
  // подстраницы логистики/склада не в меню — не сбрасывать на главную
  const subPages = ["logSend", "logForm", "logReceive", "logTrack", "logHistory", "whpick", "settings", "qr", "assemble", "issue", "unpack", "receive", "returnbag", "cells", "bags", "board", "eans", "points"];
  if (!items.find(i => i[0] === page) && !subPages.includes(page)) page = items[0][0];
  const logisticsSubs = ["logSend", "logForm", "logReceive", "logTrack", "logHistory"];
  nav.innerHTML = items.map(([id, label]) => {
    const active = page === id || (id === "logistics" && logisticsSubs.includes(page)) || (id === "whpick" && page === "whpick");
    return `<button class="${active ? "active" : ""}" data-p="${id}">${label}</button>`;
  }).join("");
  nav.querySelectorAll("button").forEach(b => {
    b.onclick = () => {
      if (b.dataset.p === "logistics") { openLogistics(); return; }
      page = b.dataset.p; render();
    };
  });
  const c = document.getElementById("content");
  c.innerHTML = "<p style='color:var(--muted)'>Загрузка...</p>";
  Promise.resolve(renderPage()).then(html => { c.innerHTML = html; afterRender(); })
    .catch(e => { c.innerHTML = `<div class="error">${e.message}</div>`; });
}

async function renderPage() {
  switch (page) {
    case "home": return renderHome();
    case "lookup": return renderLookup();
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
    case "orderHistory": return renderOrderHistory();
    case "profile": return renderProfile();
    case "settings": return renderSettings();
    case "qr": return renderQrTool();
    case "shift": return renderShift();
    case "logistics": return renderLogistics();
    case "warehouses": return renderWarehouses();
    case "whpick": return renderWhPick();
    case "logForm": return renderLogForm();
    case "logReceive": return renderLogReceive();
    case "logSend": return renderLogSend();
    case "logTrack": return renderLogTrack();
    case "logHistory": return renderLogHistory();
    default: return "<p>Раздел</p>";
  }
}
function afterRender() {
  const inp = document.querySelector(".scan-box input");
  if (inp) inp.focus();
}


async function renderLookup() {
  return `
    <div class="page-h"><h1>Информация по объекту</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div class="scan-box">
      <div>Отсканируйте любой код</div>
      <input id="lookup-code" placeholder="dd… / sumka… / DY… / us… / EAN / ORD…"
        onkeydown="if(event.key==='Enter')doLookup()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="doLookup()">Показать</button>
    </div>
    <div id="lookup-result" style="margin-top:1rem"></div>
`;
}
window.doLookup = async () => {
  const code = document.getElementById("lookup-code").value.trim();
  const box = document.getElementById("lookup-result");
  if (!code) { toast("Введите или отсканируйте код", true); return; }
  box.innerHTML = "<p style='color:var(--muted)'>Поиск…</p>";
  try {
    const r = await api("/lookup?code=" + encodeURIComponent(code));
    const d = r.details || {};
    let extra = "";
    if (r.kind === "equipment") {
      extra = `
        <div style="margin-top:0.75rem;font-size:0.9rem;color:var(--muted)">
          ID: <code>${d.id}</code>${d.ean ? " · EAN " + d.ean : ""}<br>
          ${d.cell_code ? "Ячейка: " + d.cell_code + "<br>" : ""}
          ${d.bag_id ? "Сумка: " + d.bag_id + "<br>" : ""}
          Последние: ${d.last_user_1 || "—"} / ${d.last_user_2 || "—"}
        </div>`;
    } else if (r.kind === "bag") {
      extra = `
        <div style="margin-top:0.75rem;font-size:0.9rem">
          ${d.order_id ? "Заказ: " + d.order_id + "<br>" : ""}
          ${d.address ? d.address + "<br>" : ""}
          ${d.object_info ? "<span style='color:var(--muted)'>" + d.object_info + "</span><br>" : ""}
          В сумке: <b>${d.items_count || 0}</b> ед.
          <ul class="item-list">${(d.items || []).map(i => `<li>${i.name} <code>${i.id}</code></li>`).join("") || "<li>—</li>"}</ul>
        </div>`;
    } else if (r.kind === "cell") {
      extra = `<ul class="item-list">${(d.items || []).map(i => `<li>${i.name} <code>${i.id}</code></li>`).join("") || "<li>пусто</li>"}</ul>`;
    } else if (r.kind === "ean") {
      extra = `<ul class="item-list">${Object.entries(d.placement || {}).map(([k, v]) =>
        `<li><b>${k}</b>: ${(v || []).join(", ")}</li>`).join("") || "<li>—</li>"}</ul>`;
    } else if (r.kind === "user") {
      extra = `<div style="margin-top:0.5rem">Сумки у сотрудника: ${(d.bags_in_use || []).map(b => b.id).join(", ") || "—"}</div>`;
    } else if (r.kind === "order") {
      extra = `<div style="margin-top:0.5rem;font-size:0.9rem;color:var(--muted)">
        ${d.id}${d.client_name ? " · " + d.client_name : ""}<br>
        ${d.object_info || ""}</div>`;
    }
    box.innerHTML = `
      <div class="card">
        <div style="font-size:0.75rem;text-transform:uppercase;color:var(--muted);letter-spacing:0.04em">${r.kind || ""}</div>
        <div style="font-size:1.15rem;font-weight:700;margin:0.35rem 0">${r.title || r.code}</div>
        <div class="status status-ok" style="display:inline-block">${r.status || ""}</div>
        <div style="margin-top:0.75rem;padding:0.75rem;background:var(--bg);border-radius:10px;border:1px solid var(--border)">
          <div style="font-size:0.75rem;color:var(--muted)">ГДЕ СЕЙЧАС</div>
          <div style="font-size:1.05rem;font-weight:600;color:var(--primary);margin-top:0.25rem">${r.location || "—"}</div>
        </div>
        ${extra}
      </div>`;
    document.getElementById("lookup-code").select();
  } catch (e) {
    box.innerHTML = `<div class="error">${e.message}</div>`;
    toast(e.message, true);
  }
};



function renderProfile() {
  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=" + encodeURIComponent(user.id);
  const blocked = user.status === "blocked";
  return `
    <div class="page-h"><h1>Профиль</h1></div>
    ${blocked ? `<div class="card" style="border-color:var(--danger)"><p style="color:var(--danger);font-weight:700">Доступ к заказам заблокирован</p></div>` : ""}
    <div class="card" style="text-align:center">
      <p style="color:var(--muted);margin-bottom:0.75rem">QR учётной записи — покажите на складе</p>
      <img src="${qrUrl}" alt="QR ${user.id}" width="220" height="220"
        style="background:#fff;border-radius:12px;padding:8px;margin:0 auto;display:block" />
      <div style="margin-top:1rem;font-size:1.25rem;font-weight:700;letter-spacing:0.04em">${user.id}</div>
      <div style="color:var(--muted);margin-top:0.35rem">${user.full_name}</div>
      <div style="color:var(--muted);font-size:0.9rem">${user.role_label || user.role}</div>
    </div>
    ${user.role === "admin" ? `
    <div class="card">
      <div class="card-title">Смена имени / пароля</div>
      <label>ФИО</label><input id="adm-name" value="${user.full_name || ""}" />
      <label>Новый пароль</label><input id="adm-pass" type="password" placeholder="оставьте пустым, если не менять" />
      <button class="btn btn-primary btn-block" onclick="adminSaveSelf()">Сохранить</button>
    </div>` : ""}`;
}
window.adminSaveSelf = async () => {
  try {
    const body = { full_name: document.getElementById("adm-name").value.trim() };
    const pw = document.getElementById("adm-pass").value;
    if (pw) body.password = pw;
    const r = await api("/admin/profile", { method: "POST", body: JSON.stringify(body) });
    user.full_name = r.full_name;
    sessionStorage.setItem("dv_user", JSON.stringify(user));
    toast("Сохранено"); render();
  } catch (e) { toast(e.message, true); }
};




async function renderOrderHistory() {
  const orders = await api("/orders?scope=history");
  const isAdmin = user.role === "admin";
  return `
    <div class="page-h"><h1>История заказов</h1>
      <p style="color:var(--muted);font-size:0.85rem">${isAdmin ? "Завершённые за 3 месяца" : "Завершённые в текущем месяце"}</p>
    </div>
    ${orders.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Заказ</th><th>Адрес</th><th>Статус</th><th>Завершён</th></tr></thead>
      <tbody>${orders.map(o => `
        <tr>
          <td>${o.id}${o.bag_id ? "<br><small>"+o.bag_id+"</small>" : ""}</td>
          <td>${o.address || ""}${o.is_late ? "<br><small style=color:var(--danger)>опоздание</small>" : ""}</td>
          <td>${o.status_label}</td>
          <td>${fmtOrderTime(o.completed_at)}</td>
        </tr>`).join("")}
      </tbody></table></div>` : "<p style='color:var(--muted)'>Нет завершённых заказов</p>"}`;
}

async function renderHome() {
  if (user.role === "supervisor" || user.role === "warehouse" || user.role === "admin") {
    const isAdmin = user.role === "admin";
    return `
      <div class="page-h"><h1>Склад</h1></div>
      <div id="signal-banner" class="card" style="border-color:var(--warning);color:var(--warning);display:none"></div>
      <div class="tsd-grid">
        <button class="btn btn-primary btn-lg" onclick="page='assemble';render()">СБОРКА</button>
        <button class="btn btn-accent btn-lg" onclick="page='issue';render()">ВЫДАЧА</button>
        <button class="btn btn-lg" style="background:#3d2e10;color:var(--warning)" onclick="page='returnbag';render()">ВОЗВРАТ</button>
        <button class="btn btn-lg" style="background:#334d40;color:var(--primary)" onclick="page='unpack';render()">РАЗБОР</button>
        <button class="btn btn-lg" style="background:#1e2e26;color:var(--accent);border:1px solid var(--border)" onclick="page='receive';render()">ПРИЁМКА</button>
        <button class="btn btn-lg" style="background:#1e2e26;color:var(--accent);border:1px solid var(--border)" onclick="openLogistics()">ЛОГИСТИКА</button>
      </div>
      <div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem">
        <button class="btn btn-ghost btn-sm" onclick="page='shift';render()">Смена</button>
        <button class="btn btn-ghost btn-sm" onclick="page='board';render()">Очередь</button>
        ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="page='cells';render()">Ячейки</button>
        <button class="btn btn-ghost btn-sm" onclick="page='bags';render()">Сумки</button>
        <button class="btn btn-ghost btn-sm" onclick="page='settings';render()">Настройки</button>
        <button class="btn btn-ghost btn-sm" onclick="page='qr';render()">QR</button>` : ""}
      </div>`;
  }
  if (user.status === "blocked") {
    const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=" + encodeURIComponent(user.id);
    return `<div class="page-h"><h1>Мои заказы</h1></div>
      <div class="card" style="border-color:var(--danger);text-align:center">
        <p style="color:var(--danger);font-weight:700;font-size:1.1rem">Доступ к заказам заблокирован</p>
        <p style="color:var(--muted);margin:0.75rem 0">Обратитесь к администратору</p>
        <img src="${qrUrl}" width="200" height="200" style="background:#fff;border-radius:12px;padding:8px;margin:0.5rem auto;display:block" />
        <div style="font-weight:700;margin-top:0.5rem">${user.id}</div>
        <div style="color:var(--muted)">${user.full_name}</div>
      </div>`;
  }
  const orders = await api("/orders?scope=active");
  return `<div class="page-h"><h1>Мои заказы</h1></div>
    ${orders.map(o => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap">
          <b>${o.address}</b>
          <span class="status ${o.is_late ? "status-bad" : "status-warn"}">${o.status_label}</span>
        </div>
        <div style="margin-top:0.4rem;font-size:0.9rem;color:var(--muted)">
          ${o.id}${o.bag_id ? " · " + o.bag_id : ""}
          ${o.object_info ? "<br>" + o.object_info : ""}
        </div>
        ${o.status === "ready" ? `<p style="margin-top:0.5rem;color:var(--accent)">Сумка ожидает на точке передачи</p>` : ""}
        ${o.payment_amount || o.pay_url ? payQrBlock(o) : ""}
        ${o.status === "issued" ? `<button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="reqComplete('${o.id}')">Заказ выполнен</button>` : ""}
      </div>`).join("") || "<p style='color:var(--muted)'>Нет заказов</p>"}`;
}

window.reqComplete = async (id) => {
  try {
    const r = await api("/orders/" + id + "/request-complete", { method: "POST" });
    toast(r.message);
    render();
  } catch (e) { toast(e.message, true); }
};

/* ASSEMBLY */
let asm = {};
async function renderAssemble() {
  asm = {};
  const board = await api("/assembly/board");
  const waiting = board.filter(b => ["awaiting_assembly", "assembling", "assembling_late"].includes(b.status));
  return `
    <div class="page-h"><h1>Сборка</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="asm-area">
      <p style="color:var(--muted);margin-bottom:0.75rem">Сумка должна быть готова за 30 мин до времени заказа. После дедлайна — опоздание</p>
      ${waiting.map(o => `
        <div class="card" style="cursor:pointer" onclick="asmPickOrder('${o.order_id || o.id}')">
          <div style="display:flex;justify-content:space-between">
            <b>Заказ ${o.order_id || o.id}</b>
            <span class="status ${o.is_late ? "status-bad" : "status-warn"}">${o.status_label}</span>
          </div>
          <div style="margin-top:0.4rem">${o.address || ""}</div>
          ${o.object_info ? `<div style="font-size:0.85rem;color:var(--muted)">${o.object_info}</div>` : ""}
          <div class="cutoff ${o.cutoff_left != null && o.cutoff_left < 0 ? "urgent" : ""}">
            Готовность: ${o.cutoff_left != null ? (o.cutoff_left < 0 ? "опоздание " + Math.abs(o.cutoff_left) + " мин" : "осталось " + o.cutoff_left + " мин") : "—"}${o.scheduled_at ? " · заказ " + fmtOrderTime(o.scheduled_at) : ""}
          </div>
        </div>`).join("") || "<p style='color:var(--muted)'>Нет заказов</p>"}
    </div>`;
}
window.asmPickOrder = (orderId) => {
  asm.orderId = orderId;
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
  try {
    if (!asm.orderId || asm.orderId === "undefined") {
      toast("Сначала выберите заказ из списка", true);
      page = "assemble"; render();
      return;
    }
    const bag = document.getElementById("scan-bag").value.trim();
    if (!bag) { toast("Отсканируйте сумку", true); return; }
    const r = await api("/assembly/start", {
      method: "POST", body: JSON.stringify({ bag_id: bag, order_id: asm.orderId }),
    });
    asm.bagId = r.bag_id;
    toast(r.message);
    document.getElementById("asm-area").innerHTML = `
      <div class="scan-info">
        <b>Сумка ${r.bag_id}</b> · ${r.order_id}<br>${r.address || ""}
        ${r.object_info ? "<br>" + r.object_info : ""}
        <br><span class="cutoff ${r.is_late ? "urgent" : ""}">
          ${r.is_late ? "ОПОЗДАНИЕ · " + (r.late_minutes || 0) + " мин" : "Cut off: " + (r.cutoff_left != null ? r.cutoff_left : r.cutoff_minutes) + " мин"}
        </span>
      </div>
      <div class="scan-box">
        <div>Оборудование (dd + 8 цифр)</div>
        <input id="scan-eq" placeholder="dd10000001" onkeydown="if(event.key==='Enter')asmAdd()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="asmAdd()">Добавить</button>
      </div>
      <ul class="item-list" id="asm-items"></ul>
      <div class="scan-box">
        <div>Точка передачи (TP01…)</div>
        <input id="scan-tp" placeholder="TP01" list="tp-list" />
        <datalist id="tp-list"></datalist>
        <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="asmFinish()">Завершить сборку</button>
      </div>`;
    loadTpList();
    document.getElementById("scan-eq").focus();
  } catch (e) { toast(e.message, true); }
};
window.asmAdd = async () => {
  try {
    const r = await api("/assembly/add-item", {
      method: "POST", body: JSON.stringify({ bag_id: asm.bagId, equipment_id: document.getElementById("scan-eq").value.trim() }),
    });
    document.getElementById("asm-items").innerHTML = r.items.map(i => `<li><span>${i.name}</span><code>${i.id}</code></li>`).join("");
    document.getElementById("scan-eq").value = "";
    document.getElementById("scan-eq").focus();
    toast("Добавлено: " + r.name);
  } catch (e) { toast(e.message, true); }
};
window.asmFinish = async () => {
  try {
    const r = await api("/assembly/finish", {
      method: "POST", body: JSON.stringify({ bag_id: asm.bagId, transfer_point: document.getElementById("scan-tp").value.trim() }),
    });
    toast(r.message);
    page = "home"; render();
  } catch (e) { toast(e.message, true); }
};
window.loadTpList = async () => {
  try {
    const list = await api("/transfer-points");
    const dl = document.getElementById("tp-list");
    if (dl) dl.innerHTML = list.map(p => `<option value="${p.code}">${p.name}</option>`).join("");
  } catch (_) {}
};

/* ISSUE */
let iss = {};
async function renderIssue() {
  return `
    <div class="page-h"><h1>Выдача</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="iss-area">
      <div class="scan-box">
        <div>1. QR исполнителя (usXXXXXX)</div>
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
      <div>2. Сумка</div>
      <input id="iss-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')issGo()" />
      <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="issGo()">Выдать</button>
    </div>`;
  document.getElementById("iss-bag").focus();
};
window.issGo = async () => {
  try {
    const r = await api("/issue", { method: "POST", body: JSON.stringify({ executor_id: iss.executor, bag_id: document.getElementById("iss-bag").value.trim() }) });
    toast(r.message); page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

/* UNPACK */
let unp = {};

async function renderUnpack() {
  unp = {};
  return `
    <div class="page-h"><h1>Разбор сумки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="unp-area">
      <div class="scan-box">
        <div>Отсканируйте сумку</div>
        <input id="unp-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')unpStart()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="unpStart()">Начать</button>
      </div>
    </div>`;
}

window.unpStart = async () => {
  try {
    const code = (document.getElementById("unp-bag")?.value || "").trim();
    if (!code) { toast("Отсканируйте сумку", true); return; }
    const r = await api("/unpack/start", { method: "POST", body: JSON.stringify({ code }) });
    unp.bagId = r.bag_id;
    unp.expected = r.expected || [];
    toast(r.message || "Сканируйте оборудование");
    showUnpackUI();
  } catch (e) { toast(e.message, true); }
};

function showUnpackUI() {
  unp.eqId = null;
  const left = unp.expected || [];
  document.getElementById("unp-area").innerHTML = `
    <div class="scan-info">
      <b>Сумка ${unp.bagId}</b>
      <div style="margin-top:0.35rem;font-size:0.85rem;color:var(--muted)">Осталось в сумке (${left.length}):</div>
      <ul class="item-list">${left.map(e => `<li>${e.name} <code>${e.id}</code></li>`).join("") || "<li>пусто</li>"}</ul>
    </div>
    <div class="scan-box">
      <div>1. Отсканируйте оборудование (dd…)</div>
      <input id="unp-eq" placeholder="dd10000001"
        onkeydown="if(event.key==='Enter')unpStepEq()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="unpStepEq()">Далее</button>
    </div>
    <button class="btn btn-danger btn-block" style="margin-top:0.5rem" onclick="unpDamage()">Зафиксировать повреждение</button>
    <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="unpEmpty()">
      Сумка пуста
    </button>
    <div id="unp-extra"></div>`;
  setTimeout(() => { const el = document.getElementById("unp-eq"); if (el) el.focus(); }, 50);
}

window.unpStepEq = () => {
  const eq = (document.getElementById("unp-eq")?.value || "").trim();
  if (!eq) { toast("Отсканируйте dd…", true); return; }
  unp.eqId = eq;
  const name = (unp.expected || []).find(e => e.id === eq || e.id === eq.toLowerCase())?.name || eq;
  const left = unp.expected || [];
  document.getElementById("unp-area").innerHTML = `
    <div class="scan-info">
      <b>Сумка ${unp.bagId}</b>
      <div style="margin-top:0.35rem">Размещаем: <b>${name}</b> <code>${eq}</code></div>
      <div style="margin-top:0.35rem;font-size:0.85rem;color:var(--muted)">Ещё в списке: ${left.length}</div>
    </div>
    <div class="scan-box">
      <div>2. Отсканируйте ячейку</div>
      <input id="unp-cell" placeholder="DY0010661/2"
        onkeydown="if(event.key==='Enter')unpItem()" />
      <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="unpItem()">Разместить</button>
      <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="showUnpackUI()">Сменить оборудование</button>
    </div>`;
  setTimeout(() => { const el = document.getElementById("unp-cell"); if (el) el.focus(); }, 50);
};

window.unpItem = async () => {
  try {
    const cell = (document.getElementById("unp-cell")?.value || "").trim();
    if (!cell) { toast("Отсканируйте ячейку", true); return; }
    const r = await api("/unpack/item", { method: "POST", body: JSON.stringify({
      bag_id: unp.bagId,
      equipment_id: unp.eqId,
      cell_code: cell,
    })});
    toast(r.message);
    unp.expected = r.remaining_items || [];
    if (r.bag_empty) {
      // всё размещено — сумка свободна, сразу на главную
      toast("Сумка разобрана и свободна");
      page = "home";
      render();
      return;
    }
    // снова список + скан dd
    showUnpackUI();
  } catch (e) { toast(e.message, true); }
};

window.unpDamage = async () => {
  // пошагово: если dd ещё не выбран — спросить скан
  let eq = unp.eqId;
  if (!eq) {
    // переход на скан dd для повреждения
    document.getElementById("unp-area").innerHTML = `
      <div class="scan-info"><b>Повреждение</b><br>Сумка ${unp.bagId}</div>
      <div class="scan-box">
        <div>Отсканируйте повреждённое оборудование (dd…)</div>
        <input id="unp-dmg-eq" placeholder="dd10000001"
          onkeydown="if(event.key==='Enter')unpDamageEq()" />
        <button class="btn btn-danger btn-block" style="margin-top:0.75rem" onclick="unpDamageEq()">Далее</button>
        <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="showUnpackUI()">Отмена</button>
      </div>`;
    setTimeout(() => document.getElementById("unp-dmg-eq")?.focus(), 50);
    return;
  }
  await unpDamageSend(eq);
};

window.unpDamageEq = async () => {
  const eq = (document.getElementById("unp-dmg-eq")?.value || "").trim();
  if (!eq) { toast("Отсканируйте dd…", true); return; }
  document.getElementById("unp-area").innerHTML = `
    <div class="scan-info"><b>Повреждение</b> <code>${eq}</code></div>
    <div class="scan-box">
      <div>Отсканируйте зону PROBLEMNOE_OBORUDOVANIE</div>
      <input id="unp-dmg-zone" placeholder="PROBLEMNOE_OBORUDOVANIE"
        onkeydown="if(event.key==='Enter')unpDamageZone('${eq}')" />
      <button class="btn btn-danger btn-block" style="margin-top:0.75rem" onclick="unpDamageZone('${eq}')">Зафиксировать</button>
      <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="showUnpackUI()">Отмена</button>
    </div>`;
  setTimeout(() => document.getElementById("unp-dmg-zone")?.focus(), 50);
};

window.unpDamageZone = async (eq) => {
  const zone = (document.getElementById("unp-dmg-zone")?.value || "").trim() || "PROBLEMNOE_OBORUDOVANIE";
  await unpDamageSend(eq, zone);
};

async function unpDamageSend(eq, zone) {
  try {
    const r = await api("/unpack/damage", { method: "POST", body: JSON.stringify({
      bag_id: unp.bagId,
      equipment_id: eq,
      zone_code: zone || "PROBLEMNOE_OBORUDOVANIE",
    })});
    toast(r.message);
    const id = eq.toLowerCase();
    unp.expected = (unp.expected || []).filter(e => e.id !== id && e.id !== eq);
    if (!unp.expected.length) {
      toast("Сумка разобрана");
      page = "home";
      render();
      return;
    }
    showUnpackUI();
  } catch (e) { toast(e.message, true); }
}

window.unpEmpty = async () => {
  try {
    const r = await api("/unpack/declare-empty", { method: "POST", body: JSON.stringify({ code: unp.bagId }) });
    if (!r.has_missing) {
      toast(r.message || "Недостач нет. Сумка свободна");
      page = "home";
      render();
      return;
    }
    // есть недостача — показать список и кнопку расследования
    document.getElementById("unp-extra").innerHTML = `
      <div class="card" style="margin-top:1rem;border-color:var(--danger)">
        <b>Не хватает в сумке:</b>
        <ul class="item-list">${r.missing.map(m => `<li>${m.name} <code>${m.id}</code></li>`).join("")}</ul>
        <button class="btn btn-danger btn-block" onclick="unpInvest()">
          Сумка пуста
        </button>
      </div>`;
  } catch (e) { toast(e.message, true); }
};

window.unpInvest = async () => {
  try {
    const r = await api("/unpack/start-investigation", { method: "POST", body: JSON.stringify({ code: unp.bagId }) });
    toast(r.message);
    page = "home";
    render();
  } catch (e) { toast(e.message, true); }
};

/* RECEIVE */
let rcv = { step: 1, ean: null, eqId: null, name: null };

function rcvShowStep1() {
  rcv.step = 1; rcv.ean = null; rcv.eqId = null; rcv.name = null;
  const area = document.getElementById("rcv-area");
  if (!area) return;
  area.innerHTML = `
    <div class="scan-box">
      <div>1. Отсканируйте EAN</div>
      <input id="rcv-ean" placeholder="4601234567890"
        onkeydown="if(event.key==='Enter')rcvStepEan()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="rcvStepEan()">Далее</button>
    </div>`;
  setTimeout(() => { const el = document.getElementById("rcv-ean"); if (el) { el.focus(); el.select(); } }, 50);
}

async function renderReceive() {
  rcv = { step: 1, ean: null, eqId: null, name: null };
  return `
    <div class="page-h"><h1>Приёмка</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="rcv-area">
      <div class="scan-box">
        <div>1. Отсканируйте EAN</div>
        <input id="rcv-ean" placeholder="4601234567890"
          onkeydown="if(event.key==='Enter')rcvStepEan()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="rcvStepEan()">Далее</button>
      </div>
    </div>`;
}
window.rcvStepEan = async () => {
  const ean = (document.getElementById("rcv-ean")?.value || "").trim();
  if (!ean) { toast("Отсканируйте EAN", true); return; }
  try {
    const types = await api("/equipment-types");
    const found = (types || []).find(x => String(x.ean) === ean);
    if (!found) { toast("EAN не найден. Добавьте в разделе EAN", true); return; }
    rcv.ean = ean;
    rcv.name = found.name;
    rcv.step = 2;
    document.getElementById("rcv-area").innerHTML = `
      <div class="scan-info">EAN ${ean} · ${found.name}</div>
      <div class="scan-box">
        <div>2. Отсканируйте единицу (dd…)</div>
        <input id="rcv-eq" placeholder="dd20000001"
          onkeydown="if(event.key==='Enter')rcvStepDd()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="rcvStepDd()">Далее</button>
        <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="rcvShowStep1()">Сменить EAN</button>
      </div>`;
    setTimeout(() => { const el = document.getElementById("rcv-eq"); if (el) el.focus(); }, 50);
  } catch (e) { toast(e.message, true); }
};
window.rcvStepDd = async () => {
  const eq = (document.getElementById("rcv-eq")?.value || "").trim();
  if (!eq) { toast("Отсканируйте dd…", true); return; }
  try {
    const r = await api("/receive", { method: "POST", body: JSON.stringify({
      ean: rcv.ean,
      equipment_id: eq,
    })});
    rcv.eqId = r.equipment_id;
    rcv.name = r.name;
    rcv.step = 3;
    toast(r.message);
    document.getElementById("rcv-area").innerHTML = `
      <div class="scan-info">${r.name} · <code>${r.equipment_id}</code></div>
      <div class="scan-box">
        <div>3. Отсканируйте ячейку</div>
        <input id="rcv-cell" placeholder="DY0010661/2"
          onkeydown="if(event.key==='Enter')rcvPlace()" />
        <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="rcvPlace()">Разместить</button>
      </div>`;
    setTimeout(() => { const el = document.getElementById("rcv-cell"); if (el) el.focus(); }, 50);
  } catch (e) { toast(e.message, true); }
};
window.rcvPlace = async () => {
  try {
    const cell = (document.getElementById("rcv-cell")?.value || "").trim();
    if (!cell) { toast("Отсканируйте ячейку", true); return; }
    const r = await api("/receive/place", { method: "POST", body: JSON.stringify({
      equipment_id: rcv.eqId, cell_code: cell,
    })});
    toast(r.message);
    // снова на EAN — следующая единица, не на главную
    rcvShowStep1();
  } catch (e) { toast(e.message, true); }
};

async function renderBoard() {
  const rows = await api("/assembly/board");
  return `
    <div class="page-h"><h1>Очередь / статусы</h1></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Время</th><th>Заказ</th><th>Адрес</th><th>Статус</th><th>Сумка</th><th>Готовность</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${r.order_id || r.id}</td>
          <td>${r.address || ""}${r.object_info ? "<br><small>" + r.object_info + "</small>" : ""}</td>
          <td><span class="status ${r.is_late ? "status-bad" : "status-warn"}">${r.status_label}</span></td>
          <td>${r.bag_id || "—"}</td>
          <td class="cutoff">${r.cutoff_left != null ? (r.cutoff_left < 0 ? "опоздание " + Math.abs(r.cutoff_left) + "м" : r.cutoff_left + "м") : "—"}</td>
        </tr>`).join("") || "<tr><td colspan=5>Пусто</td></tr>"}
      </tbody></table></div>`;
}

async function renderBags() {
  const rows = await api("/bags");
  return `
    <div class="page-h"><h1>Сумки</h1></div>
    ${user.role === "admin" ? `
    <div class="card">
      <div class="card-title">Добавить сумку</div>
      <label>Код (sumka + 5 цифр)</label>
      <input id="new-bag-id" placeholder="sumka14028" />
      <button class="btn btn-primary btn-block" onclick="bagCreate()">Добавить</button>
    </div>` : ""}
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>Сумка</th><th>Статус</th><th>Заказ</th><th>Сборщик</th><th>Исполнитель</th><th></th></tr></thead>
      <tbody>${rows.map(b => `
        <tr>
          <td><code>${b.id}</code></td>
          <td>${b.status_label}</td>
          <td>${b.order_id || "—"}</td>
          <td>${b.assembled_by || "—"}</td>
          <td>${b.executor_id || "—"}</td>
          <td style="white-space:nowrap">
            ${user.role === "admin" && b.status !== "free" ? `<button class="btn btn-ghost btn-sm" onclick="bagForceFree('${b.id}')">${b.status === "assembling" ? "Сбросить сборку" : "Свободна"}</button>` : ""}
            ${user.role === "admin" && b.status === "free" ? `<button class="btn btn-danger btn-sm" onclick="bagDelete('${b.id}')">Удалить</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.bagForceFree = async (id) => {
  if (!confirm("Сбросить сумку " + id + "?\nОборудование вернётся в ячейку, заказ снова ждёт сборки.")) return;
  try {
    toast((await api("/bags/" + id + "/force-free", { method: "POST" })).message);
    render();
  } catch (e) { toast(e.message, true); }
};
window.bagCreate = async () => {
  try {
    const r = await api("/bags", { method: "POST", body: JSON.stringify({ bag_id: document.getElementById("new-bag-id").value.trim() }) });
    toast("Добавлена " + r.id); render();
  } catch (e) { toast(e.message, true); }
};
window.bagDelete = async (id) => {
  if (!confirm("Удалить " + id + "?")) return;
  try {
    await api("/bags/" + id, { method: "DELETE" });
    toast("Удалено"); render();
  } catch (e) { toast(e.message, true); }
};


async function renderOrdersAdmin() {
  const orders = await api("/orders?scope=active");
  const canAssign = user.role === "admin" || user.role === "supervisor" || user.role === "warehouse";
  let emps = [];
  if (canAssign) {
    try { emps = await api("/shift/executors?warehouse_code=" + encodeURIComponent(warehouseCode)); } catch(_) {
      emps = (await api("/employees")).filter(e => e.role === "cleaner" || e.role === "handyman");
    }
  }
  return `
    <div class="page-h"><h1>Заказы</h1></div>
    <div class="card">
      <div class="card-title">Новый заказ</div>
      <label>Клиент</label><input id="ord-client" />
      <label>Адрес *</label><input id="ord-addr" placeholder="ул. Ленина, 7" />
      <label>Информация по объекту</label><input id="ord-info" placeholder="домофон, этаж, парковка…" />
      <label>Тип уборки</label><input id="ord-type" />
      ${canAssign ? `<label>Исполнитель</label>
      <select id="ord-exec"><option value="">—</option>${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join("")}</select>` : `<p style="color:var(--muted);font-size:0.9rem;margin:0.5rem 0">Исполнителя назначает админ или старший смены</p>`}
      <label>Время заказа *</label>
      <input id="ord-time" type="datetime-local" />
      <p style="color:var(--muted);font-size:0.8rem;margin:-0.5rem 0 0.75rem">Время — Екатеринбург (UTC+5). Сумка готова за 30 мин до заказа</p>
      <label>Сумма к оплате (₽)</label>
      <input id="ord-pay" type="number" min="1" step="1" placeholder="например 2500" />
      <p style="color:var(--muted);font-size:0.8rem;margin:-0.5rem 0 0.75rem">QR на ЮMoney для клиента (кошелёк компании)</p>
      <button class="btn btn-primary btn-block" onclick="ordCreate(true)">Создать и на сборку</button>
    </div>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>Время</th><th>Заказ / адрес</th><th>Сумка</th><th>Статус</th><th>Готовность</th><th>Исполнитель</th><th></th></tr></thead>
      <tbody>${orders.map(o => `
        <tr>
          <td style="white-space:nowrap"><b>${fmtOrderTime(o.scheduled_at)}</b></td>
          <td><b>${o.address}</b><br><small>${o.id}${o.is_late ? " · опоздание " + (o.late_minutes || "") + "м" : ""}</small>
            ${o.object_info ? "<br><small>" + o.object_info + "</small>" : ""}</td>
          <td>${o.bag_id || "—"}</td>
          <td><span class="status ${o.status === "done" ? "status-ok" : o.is_late ? "status-bad" : "status-warn"}">${o.status_label}</span></td>
          <td class="cutoff ${o.cutoff_left != null && o.cutoff_left < 0 ? "urgent" : ""}">${fmtCutoff(o)}</td>
          <td>${o.executor_id || "—"}</td>
          <td style="white-space:nowrap">
            ${o.status === "new" ? `<button class="btn btn-primary btn-sm" onclick="ordSend('${o.id}')">На сборку</button>` : ""}
            ${o.status === "completion_pending" && user.role === "admin" ? `<button class="btn btn-accent btn-sm" onclick="ordConfirm('${o.id}')">Подтвердить</button>` : ""}
            ${canAssign && !["done","cancelled"].includes(o.status) ? `<button class="btn btn-ghost btn-sm" onclick="ordReassign('${o.id}')">Сменить исп.</button>` : ""}
            ${(user.role === "admin" || user.role === "order_manager" || user.role === "supervisor") && !["done","cancelled"].includes(o.status) ? `<button class="btn btn-danger btn-sm" onclick="ordCancel('${o.id}')">Отменить</button>` : ""}
            ${o.payment_amount ? `<button class="btn btn-accent btn-sm" onclick="showPayQr('${o.id}', ${o.payment_amount})">QR оплаты</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.ordCreate = async (send) => {
  try {
    const execEl = document.getElementById("ord-exec");
    const r = await api("/orders", { method: "POST", body: JSON.stringify({
      client_name: document.getElementById("ord-client").value.trim() || null,
      address: document.getElementById("ord-addr").value.trim(),
      object_info: document.getElementById("ord-info").value.trim() || null,
      cleaning_type: document.getElementById("ord-type").value.trim() || null,
      executor_id: execEl ? (execEl.value || null) : null,
      scheduled_at: (document.getElementById("ord-time") || {}).value || null,
      cutoff_minutes: 30,
      payment_amount: parseInt((document.getElementById("ord-pay") || {}).value, 10) || null,
      send_to_assembly: send,
    })});
    toast(r.message); if (r.signal) playBeep(); render();
  } catch (e) { toast(e.message, true); }
};
window.ordSend = async (id) => {
  try { toast((await api("/orders/" + id + "/send-to-assembly", { method: "POST" })).message); playBeep(); render(); }
  catch (e) { toast(e.message, true); }
};
window.showPayQr = (id, amount) => {
  const url = "https://yoomoney.ru/to/4100119594706417/" + amount;
  const qr = "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=" + encodeURIComponent(url);
  const w = window.open("", "_blank", "width=320,height=420");
  if (!w) { toast("Разрешите всплывающие окна"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Оплата ${amount} ₽</title>
    <style>body{font-family:sans-serif;text-align:center;padding:16px;background:#0c1210;color:#f0fdf4}
    img{background:#fff;border-radius:12px;padding:10px}</style></head><body>
    <h2>Домовой</h2><p>Заказ ${id}</p><p style="font-size:1.4rem;font-weight:700">${amount} ₽</p>
    <img src="${qr}" width="260" height="260" /><p style="opacity:.7;font-size:0.85rem">ЮMoney · сканируйте для оплаты</p>
    </body></html>`);
  w.document.close();
};
window.ordCancel = async (id) => {
  if (!confirm("Отменить заказ " + id + "?\nОн попадёт в историю со статусом «Отменён».")) return;
  try {
    toast((await api("/orders/" + id + "/cancel", { method: "POST" })).message);
    render();
  } catch (e) { toast(e.message, true); }
};
window.ordConfirm = async (id) => {
  try { toast((await api("/orders/" + id + "/confirm-complete", { method: "POST" })).message); render(); }
  catch (e) { toast(e.message, true); }
};
window.ordReassign = async (id) => {
  const eid = prompt("ID нового исполнителя (us000003):");
  if (!eid) return;
  try { toast((await api("/orders/" + id + "/reassign", { method: "POST", body: JSON.stringify({ executor_id: eid }) })).message); render(); }
  catch (e) { toast(e.message, true); }
};

async function renderEmployees() {
  const list = await api("/employees");
  const next = await api("/employees/next-id");
  return `
    <div class="page-h"><h1>Сотрудники</h1></div>
    <div class="card">
      <div class="card-title">Поиск по учётке</div>
      <input id="emp-search" placeholder="us000003" onkeydown="if(event.key==='Enter')empSearch()" />
      <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="empSearch()">Найти</button>
      <div id="emp-search-result" style="margin-top:0.75rem"></div>
    </div>
    <div class="card">
      <div class="card-title">Быстрое добавление</div>
      <label>Учётная запись (us + 6 цифр)</label>
      <input id="emp-id" value="${next.id}" placeholder="us000107" />
      <p style="font-size:0.8rem;color:var(--muted);margin:0.25rem 0 0.5rem">Подставлен свободный номер — можно заменить своим</p>
      <label>ФИО</label><input id="emp-name" />
      <label>Дата рождения</label><input id="emp-bd" type="date" />
      <label>Пароль для входа</label><input id="emp-pass" type="text" placeholder="минимум 4 символа" />
      <label>Роль</label>
      <select id="emp-role">
        <option value="cleaner">Клинер</option>
        <option value="handyman">Мастер на все руки</option>
        <option value="supervisor">Старший смены</option>
        <option value="order_manager">Менеджер обработки заказов</option>
        <option value="admin">Админ</option>
      </select>
      <button class="btn btn-primary btn-block" onclick="empSave()">Сохранить</button>
    </div>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>ID</th><th>ФИО</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
      <tbody>${list.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${u.full_name}${u.status === "blocked" && u.block_reason ? "<br><small style=color:var(--danger)>блок: "+u.block_reason+"</small>" : ""}</td>
          <td>${u.role_label}</td>
          <td>${u.status}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="empEdit('${u.id}','${(u.full_name||"").replace(/'/g,"")}')">Изменить</button>
            ${u.status !== "blocked" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" onclick="empBlock('${u.id}')">Блок</button>` : ""}
            ${u.status === "blocked" ? `<button class="btn btn-accent btn-sm" onclick="empUnblock('${u.id}')">Разблок</button>` : ""}
            ${u.status === "fired" ? `<button class="btn btn-accent btn-sm" onclick="empRestore('${u.id}')">Восстановить</button>` : ""}
            <button class="btn btn-ghost btn-sm" onclick="empHist('${u.id}')">История</button>
            ${u.status !== "fired" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" onclick="empDel('${u.id}')">Увол.</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table></div>
    <div id="emp-hist-box"></div>`;
}
window.empSave = async () => {
  try {
    const r = await api("/employees", { method: "POST", body: JSON.stringify({
      id: document.getElementById("emp-id").value.trim() || null,
      full_name: document.getElementById("emp-name").value.trim(),
      birth_date: document.getElementById("emp-bd").value || null,
      role: document.getElementById("emp-role").value,
      password: document.getElementById("emp-pass").value.trim() || null,
    })});
    toast(`Создан ${r.id}, пароль: ${r.password}`);
    render();
  } catch (e) { toast(e.message, true); }
};
window.empEdit = async (id, name) => {
  const nn = prompt("ФИО:", name);
  if (nn === null) return;
  const pwd = prompt("Новый пароль (пусто = не менять):");
  const role = prompt("Роль (supervisor/order_manager/cleaner/handyman/admin, пусто = не менять):");
  try {
    const body = { full_name: nn };
    if (pwd) body.password = pwd;
    if (role && role.trim()) body.role = role.trim();
    await api("/employees/" + id, { method: "PATCH", body: JSON.stringify(body) });
    toast("Сохранено"); render();
  } catch (e) { toast(e.message, true); }
};
window.empBlock = async (id) => {
  const reason = prompt("Причина блокировки (видна только админу):");
  if (reason === null || !reason.trim()) { toast("Нужна причина", true); return; }
  try {
    toast((await api("/employees/" + id + "/block", { method: "POST", body: JSON.stringify({ reason: reason.trim() }) })).message);
    render();
  } catch (e) { toast(e.message, true); }
};
window.empUnblock = async (id) => {
  try {
    toast((await api("/employees/" + id + "/unblock", { method: "POST" })).message);
    render();
  } catch (e) { toast(e.message, true); }
};
window.empHist = async (id) => {
  try {
    const rows = await api("/employees/" + id + "/history");
    const box = document.getElementById("emp-hist-box");
    if (box) box.innerHTML = `<div class="card"><div class="card-title">История ${id}</div>
      ${rows.length ? rows.map(r => `<div style="font-size:0.85rem;margin:0.35rem 0;border-bottom:1px solid var(--border);padding-bottom:0.35rem">
        <b>${r.field}</b>: ${r.old_value || "—"} → ${r.new_value || "—"}
        <br><span style="color:var(--muted)">${r.changed_by} · ${(r.created_at||"").replace("T"," ").slice(0,16)}</span>
      </div>`).join("") : "<p style='color:var(--muted)'>Нет записей</p>"}</div>`;
  } catch (e) { toast(e.message, true); }
};
window.empSearch = async () => {
  const q = document.getElementById("emp-search").value.trim();
  if (!q) return;
  try {
    const rows = await api("/employees/search?q=" + encodeURIComponent(q));
    const box = document.getElementById("emp-search-result");
    if (!rows.length) { box.innerHTML = "<p style='color:var(--muted)'>Не найден</p>"; return; }
    box.innerHTML = rows.map(u => {
      const nameSafe = (u.full_name || "").replace(/'/g, "");
      return `
      <div style="padding:0.75rem 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;font-size:1.05rem">${u.full_name || "—"}</div>
            <div style="margin-top:0.2rem"><code>${u.id}</code>
              <span style="color:var(--muted)"> · ${u.role_label || u.role} · ${u.status}</span>
            </div>
            ${u.block_reason ? `<div style="color:var(--danger);font-size:0.85rem;margin-top:0.25rem">Блок: ${u.block_reason}</div>` : ""}
            ${u.birth_date ? `<div style="color:var(--muted);font-size:0.85rem">ДР: ${u.birth_date}</div>` : ""}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
            <button class="btn btn-ghost btn-sm" onclick="empEdit('${u.id}','${nameSafe}')">Изменить</button>
            ${u.status !== "blocked" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" onclick="empBlock('${u.id}')">Блокировать</button>` : ""}
            ${u.status === "blocked" ? `<button class="btn btn-accent btn-sm" onclick="empUnblock('${u.id}')">Разблок</button>` : ""}
            ${u.status === "fired" ? `<button class="btn btn-accent btn-sm" onclick="empRestore('${u.id}')">Восстановить</button>` : ""}
            <button class="btn btn-ghost btn-sm" onclick="empHist('${u.id}')">История</button>
            ${u.status !== "fired" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" onclick="empDel('${u.id}')">Увол.</button>` : ""}
          </div>
        </div>
      </div>`;
    }).join("");
  } catch (e) { toast(e.message, true); }
};
window.empRestore = async (id) => {
  if (!confirm("Восстановить " + id + "?")) return;
  try {
    toast((await api("/employees/" + id + "/restore", { method: "POST" })).message);
    render();
  } catch (e) { toast(e.message, true); }
};
window.empDel = async (id) => {
  if (!confirm("Уволить " + id + "? Учётку можно будет восстановить.")) return;
  try { await api("/employees/" + id, { method: "DELETE" }); toast("Уволен"); render(); }
  catch (e) { toast(e.message, true); }
};


async function renderCells() {
  const list = await api("/cells");
  return `
    <div class="page-h"><h1>Ячейки</h1></div>
    ${user.role === "admin" ? `
    <div class="card">
      <label>Код ячейки</label><input id="cell-code" placeholder="DY0010661/2" />
      <button class="btn btn-primary btn-block" onclick="cellAdd()">Добавить</button>
    </div>` : ""}
    ${list.map(c => `
      <div class="card">
        <div style="display:flex;justify-content:space-between">
          <b>${c.code}</b>
          <span>${c.count} ед.</span>
        </div>
        <div style="font-size:0.85rem;color:var(--muted)">Склад ${c.warehouse_no} · регион ${c.region} · полка ${c.shelf}/${c.slot}</div>
        <ul class="item-list">${(c.items || []).map(i => `<li>${i.name} <code>${i.id}</code></li>`).join("") || "<li>пусто</li>"}</ul>
        ${user.role === "admin" ? `<button class="btn btn-danger btn-sm" onclick="cellDel('${c.code}')">Удалить ячейку</button>` : ""}
      </div>`).join("")}`;
}
window.cellAdd = async () => {
  try { toast("Ячейка " + (await api("/cells", { method: "POST", body: JSON.stringify({ code: document.getElementById("cell-code").value.trim() }) })).code); render(); }
  catch (e) { toast(e.message, true); }
};
window.cellDel = async (code) => {
  if (!confirm("Удалить " + code + "?")) return;
  try { await api("/cells/" + encodeURIComponent(code), { method: "DELETE" }); toast("Удалено"); render(); }
  catch (e) { toast(e.message, true); }
};

async function renderMissing() {
  const rows = await api("/missing");
  return `
    <div class="page-h"><h1>Пропажи и повреждения</h1></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Оборудование</th><th>Тип</th><th>Последние 2</th><th></th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${r.name}<br><code>${r.equipment_id}</code></td>
          <td>${r.kind === "damaged" ? "Повреждение" : "Пропажа"}</td>
          <td>${r.last_user_1 || "—"} / ${r.last_user_2 || "—"}</td>
          <td>
            ${user.role === "admin" ? `<button class="btn btn-danger btn-sm" onclick="missOff(${r.id})">Списать</button>
            <button class="btn btn-accent btn-sm" onclick="missRest(${r.id})">Вернуть</button>` : "<span style='color:var(--muted)'>только просмотр</span>"}
          </td>
        </tr>`).join("") || "<tr><td colspan=4>Нет открытых</td></tr>"}
      </tbody></table></div>`;
}
window.missOff = async (id) => {
  if (!confirm("Списать?")) return;
  try { toast((await api("/missing/write-off", { method: "POST", body: JSON.stringify({ report_id: id }) })).message); render(); }
  catch (e) { toast(e.message, true); }
};
window.missRest = async (id) => {
  const cell = prompt("Ячейка для возврата:", "DY0010661/2");
  if (!cell) return;
  try { toast((await api("/missing/restore", { method: "POST", body: JSON.stringify({ report_id: id, cell_code: cell }) })).message); render(); }
  catch (e) { toast(e.message, true); }
};

async function renderEans() {
  const list = await api("/equipment-types");
  return `
    <div class="page-h"><h1>EAN</h1></div>
    <div class="card">
      <label>EAN</label><input id="ean-code" />
      <label>Название</label><input id="ean-name" />
      <button class="btn btn-primary btn-block" onclick="eanAdd()">Добавить</button>
    </div>
    ${list.map(t => `
      <div class="card">
        <div style="display:flex;justify-content:space-between">
          <div><b>${t.name}</b><br><code>${t.ean}</code></div>
          <div><b>${t.count}</b> ед.</div>
        </div>
        <details style="margin-top:0.5rem">
          <summary>Посмотреть ячейки</summary>
          <ul class="item-list">${Object.entries(t.cells || {}).map(([cell, items]) =>
            `<li><b>${cell}</b>: ${items.map(i => i.id).join(", ")}</li>`).join("") || "<li>нет</li>"}</ul>
        </details>
        <button class="btn btn-danger btn-sm" style="margin-top:0.5rem" onclick="eanDel('${t.ean}')">Удалить EAN</button>
      </div>`).join("")}`;
}
window.eanAdd = async () => {
  try {
    await api("/equipment-types", { method: "POST", body: JSON.stringify({
      ean: document.getElementById("ean-code").value.trim(),
      name: document.getElementById("ean-name").value.trim(),
    })});
    toast("Добавлено"); render();
  } catch (e) { toast(e.message, true); }
};
window.eanDel = async (ean) => {
  if (!confirm("Удалить EAN " + ean + "?")) return;
  try { await api("/equipment-types/" + encodeURIComponent(ean), { method: "DELETE" }); toast("Удалено"); render(); }
  catch (e) { toast(e.message, true); }
};

async function renderPoints() {
  const list = await api("/transfer-points");
  return `
    <div class="page-h"><h1>Точки передачи</h1></div>
    <div class="card">
      <label>Код</label><input id="tp-code" placeholder="TP04" />
      <label>Название</label><input id="tp-name" />
      <button class="btn btn-primary btn-block" onclick="tpAdd()">Добавить</button>
    </div>
    ${list.map(p => `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><code>${p.code}</code> — ${p.name}</div>
        <div>
          <button class="btn btn-ghost btn-sm" onclick="tpEdit('${p.code}','${p.name.replace(/'/g, "")}')">Изменить</button>
          <button class="btn btn-danger btn-sm" onclick="tpDel('${p.code}')">Удалить</button>
        </div>
      </div>`).join("")}`;
}
window.tpAdd = async () => {
  try {
    await api("/transfer-points", { method: "POST", body: JSON.stringify({
      code: document.getElementById("tp-code").value.trim(),
      name: document.getElementById("tp-name").value.trim(),
    })});
    toast("Добавлено"); render();
  } catch (e) { toast(e.message, true); }
};
window.tpEdit = async (code, name) => {
  const n = prompt("Название:", name);
  if (n === null) return;
  try { await api("/transfer-points/" + code, { method: "PATCH", body: JSON.stringify({ name: n }) }); toast("Сохранено"); render(); }
  catch (e) { toast(e.message, true); }
};
window.tpDel = async (code) => {
  if (!confirm("Удалить " + code + "?")) return;
  try { await api("/transfer-points/" + code, { method: "DELETE" }); toast("Удалено"); render(); }
  catch (e) { toast(e.message, true); }
};

async function renderReturnBag() {
  return `
    <div class="page-h"><h1>Возврат сумки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div class="scan-box">
      <div>Сканируйте сумку</div>
      <input id="ret-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')doReturnBag()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="doReturnBag()">Принять на разбор</button>
    </div>`;
}
window.doReturnBag = async () => {
  try {
    const r = await api("/bags/return", { method: "POST", body: JSON.stringify({ bag_id: document.getElementById("ret-bag").value.trim() }) });
    toast(r.message); page = "unpack"; render();
  } catch (e) { toast(e.message, true); }
};


/* WAREHOUSE / SHIFT / LOGISTICS */
async function renderWhPick() {
  return `
    <div class="page-h"><h1>Выбор склада</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div class="scan-box">
      <div>Отсканируйте код склада (6 цифр)</div>
      <input id="wh-scan" placeholder="001066" value="${warehouseCode}"
        onkeydown="if(event.key==='Enter')whApplyScan()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="whApplyScan()">Выбрать</button>
    </div>
    <p style="color:var(--muted);margin-top:1rem">Текущий склад: <b>${warehouseCode}</b></p>`;
}
window.whApplyScan = async () => {
  const code = (document.getElementById("wh-scan")?.value || "").trim();
  if (!/^\d{6}$/.test(code)) { toast("Код склада: 6 цифр", true); return; }
  try {
    const list = await api("/warehouses");
    if (!list.find(w => w.code === code)) { toast("Склад не найден в системе", true); return; }
    setWarehouse(code);
    toast("Склад " + code); page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

async function renderWarehouses() {
  const list = await api("/warehouses");
  let stock = [];
  try { stock = await api("/warehouses/stock"); } catch (_) {}
  return `
    <div class="page-h"><h1>Склады</h1></div>
    <div class="card">
      <div class="card-title">Создать склад</div>
      <label>Код (6 цифр)</label><input id="wh-code" placeholder="001066" />
      <label>Название</label><input id="wh-name" placeholder="Основной склад" />
      <button class="btn btn-primary btn-block" onclick="whAdd()">Сохранить</button>
    </div>
    <div class="card">
      <div class="card-title">Остатки по складам</div>
      ${stock.map(s => `
        <div style="margin:0.75rem 0;padding-bottom:0.75rem;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <b>Склад ${s.code}</b>
            <span><b>${s.count}</b> ед.</span>
          </div>
          <div style="font-size:0.85rem;color:var(--muted)">${s.name || ""}</div>
          <ul class="item-list" style="margin-top:0.35rem">
            ${(s.items || []).map(i => `<li><code>${i.id}</code> ${i.name || ""}
              <span style="color:var(--muted)">${i.cell_code ? " · " + i.cell_code : ""}${i.status && i.status !== "in_cell" ? " · " + i.status : ""}</span>
            </li>`).join("") || "<li style='color:var(--muted)'>пусто</li>"}
          </ul>
        </div>`).join("") || "<p style='color:var(--muted)'>Нет данных</p>"}
    </div>
    ${list.map(w => `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><code>${w.code}</code> — ${w.name}${w.is_main?" (основной)":""}</div>
        ${user.role==="admin"?`<button class="btn btn-danger btn-sm" onclick="whDel('${w.code}')">Удал.</button>`:""}
      </div>`).join("")}`;
}
window.whAdd = async () => {
  try {
    await api("/warehouses", { method: "POST", body: JSON.stringify({
      code: document.getElementById("wh-code").value.trim(),
      name: document.getElementById("wh-name").value.trim(),
    })});
    toast("Склад добавлен"); render();
  } catch (e) { toast(e.message, true); }
};
window.whDel = async (code) => {
  if (!confirm("Удалить склад " + code + "?")) return;
  try { await api("/warehouses/" + code, { method: "DELETE" }); toast("Удалено"); render(); }
  catch (e) { toast(e.message, true); }
};

async function renderShift() {
  const list = await api("/shift/today?warehouse_code=" + encodeURIComponent(warehouseCode));
  return `
    <div class="page-h"><h1>Смена · ${warehouseCode}</h1></div>
    <div class="scan-box">
      <div>Отсканируйте QR сотрудника на смену</div>
      <input id="shift-us" placeholder="us000003"
        onkeydown="if(event.key==='Enter')shiftMark()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="shiftMark()">Отметить на смене</button>
    </div>
    <div class="card" style="margin-top:1rem">
      <div class="card-title">На смене сегодня (${list.length})</div>
      ${list.map(u => `
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border)">
          <div><b>${u.full_name}</b><br><code>${u.user_id}</code> · ${u.role_label}</div>
          <button class="btn btn-ghost btn-sm" onclick="shiftUnmark('${u.user_id}')">Снять</button>
        </div>`).join("") || "<p style='color:var(--muted)'>Пока никого</p>"}
    </div>`;
}
window.shiftMark = async () => {
  try {
    const r = await api("/shift/mark", { method: "POST", body: JSON.stringify({
      user_id: document.getElementById("shift-us").value.trim(),
      warehouse_code: warehouseCode,
    })});
    toast(r.message); render();
  } catch (e) { toast(e.message, true); }
};
window.shiftUnmark = async (id) => {
  try {
    await api("/shift/mark?user_id=" + encodeURIComponent(id) + "&warehouse_code=" + encodeURIComponent(warehouseCode), { method: "DELETE" });
    toast("Снят со смены"); render();
  } catch (e) { toast(e.message, true); }
};

window.logWhConfirm = async () => {
  const code = (document.getElementById("log-wh")?.value || "").trim();
  if (!/^\d{6}$/.test(code)) { toast("Код склада: 6 цифр", true); return; }
  try {
    const list = await api("/warehouses");
    if (!list.find(w => w.code === code)) { toast("Склад не найден", true); return; }
    setWarehouse(code);
    sessionStorage.setItem("dv_wh_confirmed", "1");
    toast("Склад " + code);
    page = "logistics";
    render();
  } catch (e) { toast(e.message, true); }
};
window.openLogistics = () => {

  // всегда сначала скан склада
  sessionStorage.removeItem("dv_wh_confirmed");
  page = "logistics";
  render();
};

async function renderLogistics() {
  const confirmed = sessionStorage.getItem("dv_wh_confirmed") === "1" && warehouseCode;
  if (!confirmed) {
    return `
      <div class="page-h"><h1>Логистика</h1>
        <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
      <div class="scan-box">
        <div>Отсканируйте код склада (6 цифр)</div>
        <input id="log-wh" placeholder="001066"
          onkeydown="if(event.key==='Enter')logWhConfirm()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="logWhConfirm()">Далее</button>
      </div>`;
  }
  const forming = await api("/logistics/forming?warehouse_code=" + encodeURIComponent(warehouseCode));
  return `
    <div class="page-h"><h1>Логистика · ${warehouseCode}</h1>
      <button class="btn btn-ghost btn-sm" onclick="sessionStorage.removeItem('dv_wh_confirmed');page='logistics';render()">Сменить склад</button>
    </div>
    <div class="tsd-grid">
      ${user.role === "admin" ? `
        <button class="btn btn-primary btn-lg" onclick="page='logSend';render()">Создать поставку</button>
      ` : ""}
      <button class="btn btn-primary btn-lg" onclick="page='logForm';render()">Собрать поставку</button>
      <button class="btn btn-accent btn-lg" onclick="page='logReceive';render()">Принять поставку</button>
      <button class="btn btn-lg" style="background:#1e2e26;color:var(--accent);border:1px solid var(--border)" onclick="page='logTrack';render()">Отследить</button>
      ${(user.role === "admin" || user.role === "supervisor" || user.role === "warehouse") ? `
        <button class="btn btn-ghost btn-lg" onclick="page='logHistory';render()">История поставок</button>
      ` : ""}
    </div>
    ${forming.length ? `<div class="card" style="margin-top:1rem"><div class="card-title">Формируется сейчас</div>
      ${forming.map(s => `<div><code>${s.id}</code> → ${s.to_warehouse}: <b>${s.items_count}</b> ед.
        ${user.role==="admin"?` <button class="btn btn-sm btn-primary" onclick="logSendNow('${s.id}')">Отправить</button>`:""}
      </div>`).join("")}
    </div>` : ""}`;
}

// logSend page as dynamic via page switch - add cases
async function renderLogSend() {
  if (user.role !== "admin") {
    toast("Создать поставку может только админ", true);
    page = "logistics"; return renderLogistics();
  }
  const whs = await api("/warehouses");
  let staff = [];
  try { staff = (await api("/employees")).filter(e => e.role === "supervisor" || e.role === "warehouse" || e.role === "admin"); } catch(_) {}
  return `
    <div class="page-h"><h1>Отправка поставки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='logistics';render()">Назад</button></div>
    <div class="card">
      <label>Склад назначения</label>
      <select id="log-to">${whs.filter(w=>w.code!==warehouseCode).map(w=>`<option value="${w.code}">${w.code} — ${w.name}</option>`).join("")}</select>
      <label>Номер поставки (11 цифр)</label>
      <input id="log-sid" placeholder="04837247362" />
      <label>Кто формирует (склад)</label>
      <select id="log-asm">${staff.map(e=>`<option value="${e.id}">${e.full_name} (${e.id})</option>`).join("")}</select>
      <label>Тип</label>
      <select id="log-kind">
        <option value="transfer">Обычная поставка</option>
        <option value="return_defect">Обратная (брак)</option>
      </select>
      <button class="btn btn-primary btn-block" onclick="logCreateShip()">Начать формирование поставки</button>
    </div>`;
}
window.logCreateShip = async () => {
  try {
    const r = await api("/logistics/shipments", { method: "POST", body: JSON.stringify({
      shipment_id: document.getElementById("log-sid").value.trim(),
      to_warehouse: document.getElementById("log-to").value,
      from_warehouse: warehouseCode,
      assembler_id: document.getElementById("log-asm").value,
      kind: document.getElementById("log-kind").value,
    })});
    toast(r.message); page = "logistics"; render();
  } catch (e) { toast(e.message, true); }
};
window.logSendNow = async (id) => {
  if (!confirm("Отправить поставку " + id + "?")) return;
  try {
    toast((await api("/logistics/send", { method: "POST", body: JSON.stringify({ shipment_id: id }) })).message);
    render();
  } catch (e) { toast(e.message, true); }
};

let logPack = { eqId: null };
async function renderLogForm() {
  const forming = await api("/logistics/forming?warehouse_code=" + encodeURIComponent(warehouseCode));
  logPack = { eqId: null };
  return `
    <div class="page-h"><h1>Формирование поставок</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='logistics';render()">Назад</button></div>
    <div class="card">
      ${forming.map(s => `<div style="padding:0.35rem 0"><code>${s.id}</code> : <b>${s.items_count}</b> ед. → ${s.to_warehouse}</div>`).join("") || "<p style='color:var(--muted)'>Нет поставок на формировании</p>"}
    </div>
    <div id="log-pack-area" class="scan-box" style="margin-top:1rem">
      <div>Отсканируйте оборудование (dd…)</div>
      <input id="log-eq" placeholder="dd10000001" onkeydown="if(event.key==='Enter')logPackEq()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="logPackEq()">Далее</button>
    </div>`;
}
window.logPackEq = () => {
  const eq = (document.getElementById("log-eq")?.value || "").trim();
  if (!eq) { toast("Сканируйте dd…", true); return; }
  logPack.eqId = eq;
  document.getElementById("log-pack-area").innerHTML = `
    <div class="scan-info">Оборудование <code>${eq}</code></div>
    <div>Отсканируйте номер поставки (11 цифр)</div>
    <input id="log-psid" placeholder="04837247362" onkeydown="if(event.key==='Enter')logPackDo()" />
    <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="logPackDo()">В поставку</button>
    <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="page='logForm';render()">Сменить</button>`;
  setTimeout(() => document.getElementById("log-psid")?.focus(), 50);
};
window.logPackDo = async () => {
  try {
    const r = await api("/logistics/pack", { method: "POST", body: JSON.stringify({
      equipment_id: logPack.eqId,
      shipment_id: document.getElementById("log-psid").value.trim(),
    })});
    toast(r.message); page = "logForm"; render();
  } catch (e) { toast(e.message, true); }
};

let logRcv = { shipmentId: null, eqId: null };
async function renderLogReceive() {
  logRcv = { shipmentId: null, eqId: null };
  return `
    <div class="page-h"><h1>Приём поставки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='logistics';render()">Назад</button></div>
    <div id="log-rcv-area" class="scan-box">
      <div>Отсканируйте номер поставки (11 цифр)</div>
      <input id="log-rsid" placeholder="04837247362" onkeydown="if(event.key==='Enter')logRcvStart()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="logRcvStart()">Начать приёмку</button>
    </div>`;
}
window.logRcvStart = async () => {
  try {
    const sid = document.getElementById("log-rsid").value.trim();
    const r = await api("/logistics/start-receive", { method: "POST", body: JSON.stringify({ shipment_id: sid }) });
    logRcv.shipmentId = r.shipment_id;
    toast(r.message);
    logRcvShowScan(r);
  } catch (e) { toast(e.message, true); }
};
function logRcvShowScan(r) {
  const pending = (r.pending || []).map(p => `<li>${p.name}${p.ean ? " · EAN " + p.ean : ""}</li>`).join("");
  document.getElementById("log-rcv-area").innerHTML = `
    <div class="scan-info">Поставка <code>${logRcv.shipmentId}</code>
      <div style="font-size:0.85rem;color:var(--muted);margin-top:0.35rem">Ожидается (без кодов dd):</div>
      <ul class="item-list">${pending || "<li>—</li>"}</ul>
    </div>
    <div class="scan-box">
      <div>1. Отсканируйте dd…</div>
      <input id="log-req" placeholder="dd10000001" onkeydown="if(event.key==='Enter')logRcvEq()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="logRcvEq()">Далее</button>
    </div>
    <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="logRcvFinish()">Поставка принята</button>`;
  setTimeout(() => document.getElementById("log-req")?.focus(), 50);
}
window.logRcvEq = () => {
  const eq = (document.getElementById("log-req")?.value || "").trim();
  if (!eq) { toast("Сканируйте dd…", true); return; }
  logRcv.eqId = eq;
  document.getElementById("log-rcv-area").innerHTML = `
    <div class="scan-info"><code>${eq}</code> → ячейка</div>
    <div class="scan-box">
      <div>2. Отсканируйте ячейку</div>
      <input id="log-rcell" placeholder="DY0010661/2" onkeydown="if(event.key==='Enter')logRcvItem()" />
      <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="logRcvItem()">Разместить</button>
    </div>`;
  setTimeout(() => document.getElementById("log-rcell")?.focus(), 50);
};
window.logRcvItem = async () => {
  try {
    const r = await api("/logistics/receive-item", { method: "POST", body: JSON.stringify({
      shipment_id: logRcv.shipmentId, equipment_id: logRcv.eqId,
      cell_code: document.getElementById("log-rcell").value.trim(),
    })});
    toast(r.message);
    // обновить pending
    const tr = await api("/logistics/track/" + logRcv.shipmentId);
    const pending = (tr.items || []).filter(i => i.status === "packed").map(i => ({ name: i.name, ean: i.ean }));
    logRcvShowScan({ pending });
  } catch (e) { toast(e.message, true); }
};
window.logRcvFinish = async () => {
  if (!confirm("Завершить приёмку поставки?")) return;
  try {
    const r = await api("/logistics/finish-receive", { method: "POST", body: JSON.stringify({ shipment_id: logRcv.shipmentId }) });
    toast(r.message);
    if (r.has_shortage) {
      const names = (r.shortage_public || []).map(x => x.name).join(", ");
      alert("Недостача (названия): " + (names || "есть"));
    }
    page = "logistics"; render();
  } catch (e) { toast(e.message, true); }
};

async function renderLogTrack() {
  return `
    <div class="page-h"><h1>Отследить поставку</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='logistics';render()">Назад</button></div>
    <div class="scan-box">
      <input id="log-tid" placeholder="11 цифр" onkeydown="if(event.key==='Enter')logDoTrack()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="logDoTrack()">Найти</button>
    </div>
    <div id="log-track-res"></div>`;
}
window.logDoTrack = async () => {
  try {
    const r = await api("/logistics/track/" + document.getElementById("log-tid").value.trim());
    document.getElementById("log-track-res").innerHTML = `
      <div class="card">
        <b>${r.id}</b> · ${r.status_label}<br>
        ${r.from_warehouse} → ${r.to_warehouse}<br>
        Ед.: ${r.items_count}
        <ul class="item-list">${(r.items||[]).map(i=>`<li>${i.name} <code>${i.equipment_id}</code> · ${i.status}</li>`).join("")}</ul>
      </div>`;
  } catch (e) { toast(e.message, true); }
};

async function renderLogHistory() {
  const rows = await api("/logistics/history?warehouse_code=" + encodeURIComponent(warehouseCode));
  return `
    <div class="page-h"><h1>История поставок</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='logistics';render()">Назад</button>
      <p style="color:var(--muted);font-size:0.85rem">За 3 месяца · сезон 1 = июн–авг, 2 = сен–ноя, 3 = дек–фев, 4 = мар–май</p>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Поставка</th><th>Маршрут</th><th>Статус</th><th>Сезон</th><th></th></tr></thead>
      <tbody>${rows.map(s => `
        <tr>
          <td><code>${s.id}</code><br><small>${s.items_count} ед.${s.missing_count? " · недост. "+s.missing_count:""}</small></td>
          <td>${s.from_warehouse} → ${s.to_warehouse}${s.kind==="return_defect"?"<br><small>брак</small>":""}</td>
          <td>${s.status_label}</td>
          <td>${s.season || "—"}/${s.season_year || ""}</td>
          <td>${s.status==="received_shortage" && !s.shortage_visualized && user.role==="admin"
            ? `<button class="btn btn-danger btn-sm" onclick="logViz('${s.id}')">Визировать недостачу</button>` : ""}</td>
        </tr>`).join("") || "<tr><td colspan=5>Пусто</td></tr>"}
      </tbody></table></div>`;
}
window.logViz = async (id) => {
  if (!confirm("Визировать недостачу " + id + " → в пропажи?")) return;
  try {
    toast((await api("/logistics/visualize-shortage", { method: "POST", body: JSON.stringify({ shipment_id: id }) })).message);
    render();
  } catch (e) { toast(e.message, true); }
};



async function renderSettings() {
  return `
    <div class="page-h"><h1>Настройки</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div class="card">
      <div class="card-title">Справочники</div>
      <button class="btn btn-ghost btn-block" onclick="page='eans';render()">EAN</button>
      <button class="btn btn-ghost btn-block" onclick="page='points';render()">Точки передачи</button>
      <button class="btn btn-ghost btn-block" onclick="page='cells';render()">Ячейки</button>
      <button class="btn btn-ghost btn-block" onclick="page='bags';render()">Сумки</button>
      <button class="btn btn-ghost btn-block" onclick="page='receive';render()">Приёмка</button>
    </div>
    <div class="card">
      <div class="card-title">Резервная копия</div>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">
        Скачайте JSON со всеми данными. Храните у себя (на Free Render база может обнулиться).
      </p>
      <button class="btn btn-primary btn-block" onclick="downloadBackup()">Скачать бэкап</button>
    </div>`;
}
window.downloadBackup = async () => {
  try {
    const res = await fetch("/api/admin/backup", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || "Ошибка бэкапа");
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "domovoy-backup-" + new Date().toISOString().slice(0,10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Бэкап скачан");
  } catch (e) { toast(e.message, true); }
};

async function renderQrTool() {
  return `
    <div class="page-h"><h1>QR-коды</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div class="card">
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">
        Введите код (us… / dd… / sumka… / DY… / 6 цифр склада / 11 цифр поставки) — QR для экрана или печати.
      </p>
      <input id="qr-code" placeholder="us000003 или dd10000001"
        onkeydown="if(event.key==='Enter')qrShow()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="qrShow()">Показать QR</button>
    </div>
    <div id="qr-out" style="text-align:center;margin-top:1rem"></div>`;
}
window.qrShow = () => {
  const code = (document.getElementById("qr-code")?.value || "").trim();
  if (!code) { toast("Введите код", true); return; }
  const url = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=" + encodeURIComponent(code);
  document.getElementById("qr-out").innerHTML = `
    <div class="card">
      <img src="${url}" width="280" height="280" alt="QR"
        style="background:#fff;border-radius:12px;padding:10px;margin:0 auto;display:block" />
      <div style="font-size:1.25rem;font-weight:700;margin-top:1rem;letter-spacing:0.03em">${code}</div>
      <p style="color:var(--muted);font-size:0.85rem;margin-top:0.5rem">Сделайте скрин или откройте картинку для печати</p>
    </div>`;
};



function payQrBlock(o) {
  if (!o) return "";
  const amount = o.payment_amount;
  const url = o.pay_url || (amount
    ? "https://yoomoney.ru/to/4100119594706417/" + amount
    : "https://yoomoney.ru/to/4100119594706417");
  const qr = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=" + encodeURIComponent(url);
  return `
    <div style="text-align:center;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border)">
      <div style="font-weight:700;margin-bottom:0.35rem">Оплата ЮMoney${amount ? " · " + amount + " ₽" : ""}</div>
      <img src="${qr}" width="220" height="220" alt="QR оплата"
        style="background:#fff;border-radius:12px;padding:8px;margin:0 auto;display:block" />
      <p style="color:var(--muted);font-size:0.8rem;margin-top:0.5rem">Клиент сканирует камерой или в приложении банка / ЮMoney</p>
      <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${url}').then(()=>toast('Ссылка скопирована'))">Копировать ссылку</button>
    </div>`;
}

function fmtOrderTime(iso) {
  if (!iso) return "—";
  try {
    // сервер хранит екатеринбургское время без Z — не сдвигать через Date UTC
    const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (m) return m[3] + "." + m[2] + " " + m[4] + ":" + m[5];
    const d = new Date(iso);
    const p = n => String(n).padStart(2, "0");
    return p(d.getDate()) + "." + p(d.getMonth()+1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (_) { return iso; }
}
function fmtCutoff(o) {
  if (o.cutoff_left == null) return "—";
  if (o.cutoff_left < 0) return "опозд. " + Math.abs(o.cutoff_left) + "м";
  return "через " + o.cutoff_left + "м";
}

function playBeep() {
  try {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  } catch (_) {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, start, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.value = 0.2;
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur);
    };
    play(880, 0, 0.18);
    play(1175, 0.22, 0.18);
    play(880, 0.44, 0.25);
    setTimeout(() => ctx.close(), 1000);
  } catch (_) {}
}

let signalTimer = null;
let signalKnown = null;
function startSignalPoll() {
  if (signalTimer) clearInterval(signalTimer);
  if (!user || (user.role !== "supervisor" && user.role !== "warehouse" && user.role !== "admin")) return;
  // первый опрос только запоминает текущие заказы без звука
  signalKnown = null;
  const tick = async () => {
    try {
      const sigs = await api("/tsd/signals");
      const ids = (sigs || []).map(s => s.order_id || s.id).filter(Boolean);
      if (signalKnown === null) {
        signalKnown = new Set(ids);
        return;
      }
      for (const id of ids) {
        if (!signalKnown.has(id)) {
          signalKnown.add(id);
          playBeep();
          try { toast("Новый заказ на сборку: " + id); } catch (_) {}
          const el = document.getElementById("signal-banner");
          if (el) {
            el.style.display = "block";
            el.textContent = "🔔 Новый заказ: " + id + " — откройте СБОРКА";
          }
        }
      }
    } catch (_) {}
  };
  tick();
  signalTimer = setInterval(tick, 4000);
}

if (token && user) {
  api("/me").then(u => { user = u; sessionStorage.setItem("dv_user", JSON.stringify(u)); show("app"); startSignalPoll(); }).catch(logout);
} else {
  show("login");
}

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
      ["home", "Главная"], ["lookup", "Объект"], ["orders", "Заказы"], ["board", "Сборка"], ["bags", "Сумки"],
      ["employees", "Сотрудники"], ["cells", "Ячейки"], ["points", "Точки"],
      ["missing", "Пропажи"], ["receive", "Приёмка"], ["eans", "EAN"],
    ];
  }
  if (user.role === "warehouse") {
    return [
      ["home", "Главная"], ["lookup", "Объект"], ["assemble", "Сборка"], ["issue", "Выдача"],
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
    case "profile": return `<div class="card"><p><b>${user.id}</b></p><p>${user.full_name}</p><p>${user.role_label}</p></div>`;
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
    <p style="color:var(--muted);font-size:0.85rem;margin-top:1rem">
      Как в Ozon: оборудование, сумка, ячейка, сотрудник, EAN, заказ, точка передачи.
    </p>`;
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
        ${o.status === "issued" ? `<button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="reqComplete('${o.id}')">Заказ выполнен</button>` : ""}
        ${o.status === "ready" ? `<p style="margin-top:0.5rem;color:var(--accent)">Сумка ожидает на точке передачи</p>` : ""}
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
      <p style="color:var(--muted);margin-bottom:0.75rem">Можно собирать после Cut off — опоздание зафиксируется</p>
      ${waiting.map(o => `
        <div class="card" style="cursor:pointer" onclick="asmPickOrder('${o.order_id}')">
          <div style="display:flex;justify-content:space-between">
            <b>Заказ ${o.order_id}</b>
            <span class="status ${o.is_late ? "status-bad" : "status-warn"}">${o.status_label}</span>
          </div>
          <div style="margin-top:0.4rem">${o.address || ""}</div>
          ${o.object_info ? `<div style="font-size:0.85rem;color:var(--muted)">${o.object_info}</div>` : ""}
          <div class="cutoff ${o.cutoff_left != null && o.cutoff_left < 0 ? "urgent" : ""}">
            Cut off: ${o.cutoff_left != null ? (o.cutoff_left < 0 ? "просрочен на " + Math.abs(o.cutoff_left) + " мин" : o.cutoff_left + " мин") : (o.cutoff_minutes || 10) + " мин"}
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
    const r = await api("/assembly/start", {
      method: "POST", body: JSON.stringify({ bag_id: document.getElementById("scan-bag").value.trim(), order_id: asm.orderId }),
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
  return `
    <div class="page-h"><h1>Разбор</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="unp-area">
      <div class="scan-box">
        <div>Сканируйте сумку</div>
        <input id="unp-bag" placeholder="sumka14024" onkeydown="if(event.key==='Enter')unpStart()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="unpStart()">Начать</button>
      </div>
    </div>`;
}
window.unpStart = async () => {
  try {
    const r = await api("/unpack/start", { method: "POST", body: JSON.stringify({ code: document.getElementById("unp-bag").value.trim() }) });
    unp.bagId = r.bag_id; unp.expected = r.expected || [];
    showUnpackUI(); toast(r.message);
  } catch (e) { toast(e.message, true); }
};
function showUnpackUI() {
  document.getElementById("unp-area").innerHTML = `
    <div class="scan-info"><b>Сумка ${unp.bagId}</b>
      <ul class="item-list">${(unp.expected || []).map(e => `<li>${e.name} <code>${e.id}</code></li>`).join("") || "<li>—</li>"}</ul>
    </div>
    <div class="scan-box">
      <div>Оборудование</div><input id="unp-eq" placeholder="dd10000001" />
      <div style="margin-top:0.75rem">Ячейка</div>
      <input id="unp-cell" placeholder="DY0010661/2" onkeydown="if(event.key==='Enter')unpItem()" />
      <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="unpItem()">Разместить</button>
    </div>
    <button class="btn btn-danger btn-block" style="margin-top:0.5rem" onclick="unpDamage()">Зафиксировать повреждение</button>
    <button class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="unpEmpty()">Оборудование размещено</button>
    <div id="unp-extra"></div>`;
}
window.unpItem = async () => {
  try {
    const r = await api("/unpack/item", { method: "POST", body: JSON.stringify({
      bag_id: unp.bagId, equipment_id: document.getElementById("unp-eq").value.trim(),
      cell_code: document.getElementById("unp-cell").value.trim(),
    })});
    toast(r.message);
    unp.expected = r.remaining_items || [];
    if (r.bag_empty) {
      document.getElementById("unp-area").innerHTML = `
        <div class="scan-info"><b>Сумка разобрана и свободна</b></div>
        <button class="btn btn-primary btn-lg" onclick="page='home';render()">На главный</button>`;
    } else { showUnpackUI(); }
  } catch (e) { toast(e.message, true); }
};
window.unpDamage = async () => {
  const eq = prompt("Код оборудования (dd…):");
  if (!eq) return;
  try {
    const r = await api("/unpack/damage", { method: "POST", body: JSON.stringify({
      bag_id: unp.bagId, equipment_id: eq, zone_code: "PROBLEMNOE_OBORUDOVANIE",
    })});
    toast(r.message);
  } catch (e) { toast(e.message, true); }
};
window.unpEmpty = async () => {
  try {
    const r = await api("/unpack/declare-empty", { method: "POST", body: JSON.stringify({ code: unp.bagId }) });
    if (!r.has_missing) {
      toast(r.message || "Недостач нет. Сумка свободна");
      page = "home"; render();
      return;
    }
    document.getElementById("unp-extra").innerHTML = `
      <div class="card" style="margin-top:1rem"><b>Не хватает:</b>
        <ul class="item-list">${r.missing.map(m => `<li>${m.name} <code>${m.id}</code></li>`).join("")}</ul>
        <button class="btn btn-danger btn-block" onclick="unpInvest()">Сумка пуста, расследование</button>
      </div>`;
  } catch (e) { toast(e.message, true); }
};
window.unpInvest = async () => {
  try {
    const r = await api("/unpack/start-investigation", { method: "POST", body: JSON.stringify({ code: unp.bagId }) });
    toast(r.message); page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

/* RECEIVE */
let rcv = {};
async function renderReceive() {
  return `
    <div class="page-h"><h1>Приёмка</h1>
      <button class="btn btn-ghost btn-sm" onclick="page='home';render()">Назад</button></div>
    <div id="rcv-area">
      <div class="scan-box">
        <div>1. EAN</div><input id="rcv-ean" placeholder="4601234567890" />
        <div style="margin-top:0.75rem">2. Единица (dd…)</div>
        <input id="rcv-eq" placeholder="dd20000001" onkeydown="if(event.key==='Enter')rcvAccept()" />
        <button class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="rcvAccept()">Принято</button>
      </div>
    </div>`;
}
window.rcvAccept = async () => {
  try {
    const r = await api("/receive", { method: "POST", body: JSON.stringify({
      ean: document.getElementById("rcv-ean").value.trim(),
      equipment_id: document.getElementById("rcv-eq").value.trim(),
    })});
    rcv.eqId = r.equipment_id; toast(r.message);
    document.getElementById("rcv-area").innerHTML = `
      <div class="scan-info">${r.name} · <code>${r.equipment_id}</code></div>
      <div class="scan-box">
        <div>Ячейка</div>
        <input id="rcv-cell" placeholder="DY0010661/2" onkeydown="if(event.key==='Enter')rcvPlace()" />
        <button class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="rcvPlace()">Разместить</button>
      </div>`;
  } catch (e) { toast(e.message, true); }
};
window.rcvPlace = async () => {
  try {
    const r = await api("/receive/place", { method: "POST", body: JSON.stringify({
      equipment_id: rcv.eqId, cell_code: document.getElementById("rcv-cell").value.trim(),
    })});
    toast(r.message); page = "home"; render();
  } catch (e) { toast(e.message, true); }
};

async function renderBoard() {
  const rows = await api("/assembly/board");
  return `
    <div class="page-h"><h1>Очередь / статусы</h1></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Заказ</th><th>Адрес</th><th>Статус</th><th>Сумка</th><th>Cut off</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${r.order_id}</td>
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
    <div class="table-wrap"><table>
      <thead><tr><th>Сумка</th><th>Статус</th><th>Заказ</th><th>Сборщик</th><th>Исполнитель</th><th></th></tr></thead>
      <tbody>${rows.map(b => `
        <tr>
          <td><code>${b.id}</code></td>
          <td>${b.status_label}</td>
          <td>${b.order_id || "—"}</td>
          <td>${b.assembled_by || "—"}</td>
          <td>${b.executor_id || "—"}</td>
          <td>${user.role === "admin" && b.status !== "free" ? `<button class="btn btn-ghost btn-sm" onclick="bagForceFree('${b.id}')">Свободна</button>` : ""}</td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.bagForceFree = async (id) => {
  if (!confirm("Сделать " + id + " свободной?")) return;
  try {
    toast((await api("/bags/" + id + "/force-free", { method: "POST" })).message);
    render();
  } catch (e) { toast(e.message, true); }
};


async function renderOrdersAdmin() {
  const orders = await api("/orders");
  const emps = (await api("/employees")).filter(e => e.role === "cleaner" || e.role === "handyman");
  return `
    <div class="page-h"><h1>Заказы</h1></div>
    <div class="card">
      <div class="card-title">Новый заказ</div>
      <label>Клиент</label><input id="ord-client" />
      <label>Адрес *</label><input id="ord-addr" placeholder="ул. Ленина, 7" />
      <label>Информация по объекту</label><input id="ord-info" placeholder="домофон, этаж, парковка…" />
      <label>Тип уборки</label><input id="ord-type" />
      <label>Исполнитель</label>
      <select id="ord-exec"><option value="">—</option>${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join("")}</select>
      <label>Cut off</label>
      <select id="ord-cut"><option value="10">10</option><option value="15">15</option><option value="20">20</option><option value="30">30</option></select>
      <button class="btn btn-primary btn-block" onclick="ordCreate(true)">Создать и на сборку</button>
    </div>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>Заказ / адрес</th><th>Сумка</th><th>Статус</th><th>Исполнитель</th><th></th></tr></thead>
      <tbody>${orders.map(o => `
        <tr>
          <td><b>${o.address}</b><br><small>${o.id}${o.is_late ? " · опоздание " + (o.late_minutes || "") + "м" : ""}</small>
            ${o.object_info ? "<br><small>" + o.object_info + "</small>" : ""}</td>
          <td>${o.bag_id || "—"}</td>
          <td><span class="status ${o.status === "done" ? "status-ok" : o.is_late ? "status-bad" : "status-warn"}">${o.status_label}</span></td>
          <td>${o.executor_id || "—"}</td>
          <td style="white-space:nowrap">
            ${o.status === "new" ? `<button class="btn btn-primary btn-sm" onclick="ordSend('${o.id}')">На сборку</button>` : ""}
            ${o.status === "completion_pending" ? `<button class="btn btn-accent btn-sm" onclick="ordConfirm('${o.id}')">Подтвердить</button>` : ""}
            ${!["done","cancelled"].includes(o.status) ? `<button class="btn btn-ghost btn-sm" onclick="ordReassign('${o.id}')">Сменить</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.ordCreate = async (send) => {
  try {
    const r = await api("/orders", { method: "POST", body: JSON.stringify({
      client_name: document.getElementById("ord-client").value.trim() || null,
      address: document.getElementById("ord-addr").value.trim(),
      object_info: document.getElementById("ord-info").value.trim() || null,
      cleaning_type: document.getElementById("ord-type").value.trim() || null,
      executor_id: document.getElementById("ord-exec").value || null,
      cutoff_minutes: parseInt(document.getElementById("ord-cut").value, 10),
      send_to_assembly: send,
    })});
    toast(r.message); if (r.signal) playBeep(); render();
  } catch (e) { toast(e.message, true); }
};
window.ordSend = async (id) => {
  try { toast((await api("/orders/" + id + "/send-to-assembly", { method: "POST" })).message); playBeep(); render(); }
  catch (e) { toast(e.message, true); }
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
      <div class="card-title">Быстрое добавление</div>
      <label>Учётная запись</label><input id="emp-id" value="${next.id}" readonly />
      <label>ФИО</label><input id="emp-name" />
      <label>Дата рождения</label><input id="emp-bd" type="date" />
      <label>Пароль для входа</label><input id="emp-pass" type="text" placeholder="минимум 4 символа" />
      <label>Роль</label>
      <select id="emp-role">
        <option value="warehouse">Сотрудник склада</option>
        <option value="cleaner">Клинер</option>
        <option value="handyman">Мастер на все руки</option>
      </select>
      <button class="btn btn-primary btn-block" onclick="empSave()">Сохранить</button>
    </div>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>ID</th><th>ФИО</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
      <tbody>${list.map(u => `
        <tr>
          <td>${u.id}</td><td>${u.full_name}</td><td>${u.role_label}</td><td>${u.status}</td>
          <td>
            ${u.role !== "admin" ? `<button class="btn btn-ghost btn-sm" onclick="empEdit('${u.id}','${u.full_name}')">Изменить</button>
            <button class="btn btn-danger btn-sm" onclick="empDel('${u.id}')">Удалить</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.empSave = async () => {
  try {
    const r = await api("/employees", { method: "POST", body: JSON.stringify({
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
  try {
    await api("/employees/" + id, { method: "PATCH", body: JSON.stringify({
      full_name: nn, password: pwd || null,
    })});
    toast("Сохранено"); render();
  } catch (e) { toast(e.message, true); }
};
window.empDel = async (id) => {
  if (!confirm("Отключить " + id + "?")) return;
  try { await api("/employees/" + id, { method: "DELETE" }); toast("Отключён"); render(); }
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
            <button class="btn btn-danger btn-sm" onclick="missOff(${r.id})">Списать</button>
            <button class="btn btn-accent btn-sm" onclick="missRest(${r.id})">Вернуть</button>
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

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200);
  } catch (_) {}
}

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
          const el = document.getElementById("signal-banner");
          if (el) { el.style.display = "block"; el.textContent = "Новый заказ: " + s.order_id; }
        }
      }
    } catch (_) {}
  }, 8000);
}

if (token && user) {
  api("/me").then(u => { user = u; sessionStorage.setItem("dv_user", JSON.stringify(u)); show("app"); startSignalPoll(); }).catch(logout);
} else {
  show("login");
}

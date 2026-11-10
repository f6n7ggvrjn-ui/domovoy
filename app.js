const API = "/api";
let token = sessionStorage.getItem("dv_token");
let user = JSON.parse(sessionStorage.getItem("dv_user") || "null");
let page = "home";
window.page = page;
let warehouseCode = sessionStorage.getItem("dv_wh") || "001066";
function setWarehouse(code) {
  warehouseCode = code;
  sessionStorage.setItem("dv_wh", code);
}





async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(API + path, { ...opts, headers });
  } catch (netErr) {
    throw new Error("Нет связи с сервером (Failed to fetch). Проверьте интернет / VPN или подождите — Render мог «уснуть».");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error("Сессия истекла"); }
  if (!res.ok) {
    const d = data.detail;
    let msg = typeof d === "string" ? d : Array.isArray(d) ? d.map(x => x.msg).join("; ") : (data.message || "");
    if (!msg) {
      if (res.status === 405) msg = "Method Not Allowed (нужно обновить сервер)";
      else if (res.status === 404) msg = "Не найдено";
      else if (res.status === 500) msg = "Ошибка сервера";
      else msg = "Ошибка " + res.status;
    }
    throw new Error(msg);
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

function loginRequest(loginVal, passVal) {
  const url = (location.origin || "") + "/api/auth/login";
  const body = JSON.stringify({ login: loginVal, password: passVal });
  // 1) fetch
  if (typeof fetch === "function") {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: body,
      credentials: "same-origin",
      cache: "no-store",
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_) {}
        if (!res.ok) {
          var d = data.detail;
          var msg = typeof d === "string" ? d : (data.message || ("Ошибка " + res.status));
          throw new Error(msg);
        }
        return data;
      });
    });
  }
  // 2) XMLHttpRequest (старые WebView / ТСД)
  return new Promise(function (resolve, reject) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Accept", "application/json");
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = {};
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          var d = data.detail;
          reject(new Error(typeof d === "string" ? d : (data.message || ("Ошибка " + xhr.status))));
        }
      };
      xhr.onerror = function () { reject(new Error("Нет связи с сервером (XHR). Проверьте https:// и интернет на ТСД.")); };
      xhr.send(body);
    } catch (e) { reject(e); }
  });
}

document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const err = document.getElementById("login-err");
  err.classList.add("hidden");
  const loginVal = document.getElementById("login-id").value.trim();
  const passVal = document.getElementById("login-pass").value;
  if (!loginVal || !passVal) {
    err.textContent = "Введите учётку и пароль";
    err.classList.remove("hidden");
    return;
  }
  // подсказка если открыли по http
  if (location.protocol === "http:" && location.hostname.indexOf("onrender.com") !== -1) {
    err.textContent = "Откройте сайт с https:// (замок в адресе). Сейчас: http — так API может не работать.";
    err.classList.remove("hidden");
  }
  try {
    const data = await loginRequest(loginVal, passVal);
    token = data.access_token;
    user = data.user;
    sessionStorage.setItem("dv_token", token);
    sessionStorage.setItem("dv_user", JSON.stringify(user));
    try {
      user = await api("/me");
      sessionStorage.setItem("dv_user", JSON.stringify(user));
    } catch (_) {}
    page = "home";
    show("app");
    startSignalPoll();
  } catch (ex) {
    var msg = (ex && ex.message) ? ex.message : "Ошибка входа";
    if (/Failed to fetch|NetworkError|Network request failed|XHR/i.test(msg)) {
      msg = "Нет связи с API. 1) Адрес строго https://oy-9wb6.onrender.com  2) Очистите кэш браузера  3) Дата/время на ТСД автоматически";
    }
    err.textContent = msg;
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
      ["payouts", "Выплаты"],
      ["settings", "Настройки"], ["qr", "Печать ШК"], ["profile", "Профиль"],
    ];
  }
  if (user.role === "supervisor" || user.role === "warehouse") {
    return [
      ["home", "Главная"], ["lookup", "Объект"], ["orders", "Заказы"],
      ["logistics", "Логистика"], ["board", "Очередь"],
      ["shift", "Смена"], ["missing", "Пропажи"], ["profile", "Профиль"],
    ];
  }
  if (user.role === "order_manager") {
    return [
      ["cabinet", "Кабинет"], ["orders", "Заказы"], ["orderHistory", "История"],
      ["fines", "Штрафы"], ["profile", "Профиль"],
    ];
  }
  return [
    ["cabinet", "Кабинет"], ["home", "Мои заказы"], ["orderHistory", "История"],
    ["fines", "Штрафы"], ["profile", "Профиль"],
  ];
}

window.go = function(p) { page = p; window.page = p; render(); };
function recoverLayout() {
  try {
    // не трогаем zoom на iOS — ломает ввод и клавиатуру
    document.body.style.transform = "none";
    document.documentElement.style.transform = "none";
    var app = document.getElementById("screen-app");
    if (app) { app.style.transform = "none"; app.style.width = "100%"; }
    var c = document.getElementById("content");
    if (c) { c.style.transform = "none"; c.style.width = "100%"; }
  } catch (_) {}
}
window.recoverLayout = recoverLayout;

function render() {
  window.page = page;
  document.getElementById("user-label").textContent = `${user.full_name} · ${user.role_label || user.role}`;
  const nav = document.getElementById("nav");
  const items = navItems();
  // подстраницы логистики/склада не в меню — не сбрасывать на главную
  const subPages = ["logSend", "logForm", "logReceive", "logTrack", "logHistory", "whpick", "settings", "qr", "assemble", "issue", "unpack", "receive", "returnbag", "cells", "bags", "board", "eans", "points", "mgrRating", "exRating", "orderHistory", "profile", "crmReport", "fines", "cabinet"];
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
  Promise.resolve(renderPage()).then(html => { c.innerHTML = html; afterRender(); try { window.scrollTo(0,0); c.scrollTop = 0; } catch(_){} })
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
    case "cabinet": return renderCabinet();
    case "payouts": return renderPayouts();
    case "crmReport": return renderCrmReport();
    case "mgrRating": return renderMgrRating();
    case "exRating": return renderExRating();
    case "fines": return renderMyFines();
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
  recoverLayout();
  var q = document.getElementById("qr-code");
  if (q) {
    q.style.fontSize = "16px";
    q.addEventListener("touchstart", function () {
      q.focus();
    }, { passive: true });
  }

  if (document.getElementById('tg-status') && typeof window.loadTgStatus === 'function') window.loadTgStatus();


  if (document.getElementById("pct-ex")) {
    api("/finance/settings").then(s => {
      document.getElementById("pct-ex").value = s.pct_executor;
      document.getElementById("pct-mg").value = s.pct_manager;
      document.getElementById("pct-co").value = s.pct_company;
    }).catch(() => {});
  }

  const inp = document.querySelector(".scan-box input");
  if (inp) inp.focus();
}


async function renderLookup() {
  return `
    <div class="page-h"><h1>Информация по объекту</h1>
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
      <thead><tr><th>Заказ</th><th>Адрес</th><th>Сумма</th><th>Статус</th><th>Завершён</th></tr></thead>
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
  if (user.role === "admin") {
    let d = {};
    try { d = await api("/admin/dashboard"); } catch (e) {
      return `<div class="page-h"><h1>Главная</h1></div><div class="error">${e.message}</div>`;
    }
    const fmt = (n) => Number(n || 0).toLocaleString("ru-RU") + " ₽";
    return `
      <div class="page-h"><h1>Главная</h1>
        <span style="color:var(--muted);font-size:0.85rem">${d.month_key || ""}</span>
      </div>

      <div class="card">
        <div class="card-title">Активные сотрудники</div>
        <div class="stat-grid" style="margin-top:0.5rem">
          <div class="stat-card">
            <div class="label">Менеджеры</div>
            <div class="value">${d.managers_active || 0}</div>
            <button type="button" class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="go('mgrRating')">Рейтинг менеджеров</button>
          </div>
          <div class="stat-card">
            <div class="label">Исполнители</div>
            <div class="value">${d.executors_active || 0}</div>
            <button type="button" class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="go('exRating')">Рейтинг исполнителей</button>
          </div>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="label">Общая выплата сотрудникам</div>
          <div class="value lime">${fmt(d.total_payout_due)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Домовой · за месяц</div>
          <div class="value lime">${fmt(d.company_earned)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Заказы</div>
        <div class="stat-grid" style="margin-top:0.5rem">
          <div class="stat-card">
            <div class="label">Активные</div>
            <div class="value">${d.orders_active || 0}</div>
          </div>
          <div class="stat-card">
            <div class="label">Завершённые</div>
            <div class="value">${d.orders_done || 0}</div>
            <button type="button" class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="go('orderHistory')">История</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Активные заказы</div>
        ${(d.active_orders && d.active_orders.length) ? `<div class="table-wrap"><table>
          <thead><tr><th>Заказ</th><th>Статус</th><th>Сумма</th></tr></thead>
          <tbody>${d.active_orders.map(o => `<tr>
            <td><strong>${o.id}</strong><br><small style="color:var(--muted)">${o.address || ""}</small></td>
            <td>${o.status_label || o.status}</td>
            <td>${o.payment_amount != null ? Number(o.payment_amount).toLocaleString("ru-RU") + " ₽" : "—"}</td>
          </tr>`).join("")}</tbody></table></div>` : `<p style="color:var(--muted);margin:0.5rem 0 0">Нет активных</p>`}
      </div>

      <div class="card">
        <div class="card-title">Склад (быстрый доступ)</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem">
          <button type="button" class="btn btn-primary btn-sm" onclick="page='assemble';render()">Сборка</button>
          <button type="button" class="btn btn-accent btn-sm" onclick="page='issue';render()">Выдача</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="page='unpack';render()">Разбор</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="page='board';render()">Очередь</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="page='bags';render()">Сумки</button>
        </div>
      </div>`;
  }
  if (user.role === "supervisor" || user.role === "warehouse") {
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
    unp.expected = r.remaining_items || [];
    if (r.bag_empty || r.remaining === 0 || (r.bag_status === "free")) {
      toast(r.message || "Сумка разобрана и свободна");
      unp.bagId = null;
      page = "home";
      render();
      return;
    }
    toast(r.message || "Размещено");
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
      <thead><tr><th>Время</th><th>Заказ</th><th>Адрес</th><th>Сумма</th><th>Статус</th><th>Сумка</th><th>Готовность</th></tr></thead>
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
  let rows = [];
  try { rows = await api("/bags"); }
  catch (e) { return `<div class="page-h"><h1>Сумки</h1></div><div class="error">${e.message}</div>
    <p style="color:var(--muted);margin-top:0.75rem">Если видите Method Not Allowed — обновите сервер (нужен GET /api/bags).</p>`; }
  return `
    <div class="page-h"><h1>Сумки</h1></div>
    <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">Сумки появляются при сканировании кода sumka + 5 цифр (на сборке).</p>
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
  toast("Сумки добавляются только при сканировании", true);
};
window.bagDelete = async (id) => {
  if (!confirm("Удалить " + id + "?")) return;
  try {
    await api("/bags/" + id, { method: "DELETE" });
    toast("Удалено"); render();
  } catch (e) { toast(e.message, true); }
};


async function renderOrdersAdmin() {
  let orders = [];
  try { orders = await api("/orders?scope=active"); }
  catch (e) { return `<div class="page-h"><h1>Заказы</h1></div><div class="error">${e.message}</div>`; }
  const canAssign = user.role === "admin" || user.role === "supervisor" || user.role === "warehouse";
  let emps = [];
  if (canAssign) {
    try { emps = await api("/shift/executors?warehouse_code=" + encodeURIComponent(warehouseCode)); } catch(_) {
      try { emps = (await api("/employees")).filter(e => e.role === "executor" || e.role === "cleaner" || e.role === "handyman" || role === "executor" || role === "cleaner"); } catch(__) { emps = []; }
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
      <label>Сумма заказа (₽)${user.role === "admin" ? "" : " *"}</label>
      <input id="ord-pay" type="number" min="1" step="1" placeholder="например 5000" />
      <p style="color:var(--muted);font-size:0.8rem;margin:-0.5rem 0 0.75rem">Время — Екатеринбург (UTC+5). Сумка готова за 30 мин до заказа</p>
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
            ${user.role === "admin" && !["done","cancelled"].includes(o.status) ? `<button class="btn btn-danger btn-sm" onclick="ordCancel('${o.id}')">Отменить</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table></div>`;
}
window.ordCreate = async (send) => {
  try {
    const addr = (document.getElementById("ord-addr") || {}).value || "";
    if (!addr.trim()) { toast("Укажите адрес", true); return; }
    const timeEl = document.getElementById("ord-time");
    const execEl = document.getElementById("ord-exec");
    const payEl = document.getElementById("ord-pay");
    const payRaw = payEl ? payEl.value : "";
    const payment_amount = payRaw === "" ? null : parseInt(payRaw, 10);
    if (user.role !== "admin") {
      if (!payment_amount || payment_amount <= 0) { toast("Укажите сумму заказа", true); return; }
    }
    const body = {
      client_name: (document.getElementById("ord-client") || {}).value?.trim() || null,
      address: addr.trim(),
      object_info: (document.getElementById("ord-info") || {}).value?.trim() || null,
      cleaning_type: (document.getElementById("ord-type") || {}).value?.trim() || null,
      executor_id: execEl ? (execEl.value || null) : null,
      scheduled_at: timeEl && timeEl.value ? timeEl.value : null,
      cutoff_minutes: 30,
      payment_amount: payment_amount && payment_amount > 0 ? payment_amount : null,
      send_to_assembly: !!send,
    };
    const r = await api("/orders", { method: "POST", body: JSON.stringify(body) });
    toast(r.message || ("Создан " + r.id));
    
    render();
  } catch (e) { toast(e.message || "Ошибка сервера", true); }
};
window.ordSend = async (id) => {
  try { toast((await api("/orders/" + id + "/send-to-assembly", { method: "POST" })).message); render(); }
  catch (e) { toast(e.message, true); }
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
    ${window._empEditId ? `
    <div class="card" style="border:2px solid var(--primary);margin-bottom:1rem">
      <div class="card-title">Изменить сотрудника ${window._empEditId}</div>
      <form onsubmit="event.preventDefault();empEditSave('${window._empEditId}');return false;">
        <label>ФИО</label>
        <input id="edit-name" type="text" value="${(window._empEditName||"").replace(/"/g,"&quot;")}" autocomplete="off" autocorrect="off" />
        <label>Новый пароль (пусто = не менять)</label>
        <input id="edit-pass" type="text" placeholder="минимум 4 символа" autocomplete="off" />
        <label>Роль</label>
        <select id="edit-role">
          <option value="">— не менять —</option>
          <option value="supervisor">Старший смены</option>
          <option value="order_manager">CRM-менеджер</option>
          <option value="executor">Исполнитель</option>
          <option value="admin">Админ</option>
        </select>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
          <button type="button" class="btn btn-ghost btn-block" onclick="empEditCancel()">Отмена</button>
          <button type="submit" class="btn btn-primary btn-block">Сохранить изменения</button>
        </div>
      </form>
    </div>` : ""}
    ${window._empBlockId ? `
    <div class="card" style="border:2px solid var(--danger);margin-bottom:1rem">
      <div class="card-title">Блокировка ${window._empBlockId}</div>
      <form onsubmit="event.preventDefault();empBlockSave('${window._empBlockId}');return false;">
        <label>Причина (только для админа)</label>
        <input id="block-reason" type="text" placeholder="причина" autocomplete="off" />
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
          <button type="button" class="btn btn-ghost btn-block" onclick="empBlockCancel()">Отмена</button>
          <button type="submit" class="btn btn-danger btn-block">Заблокировать</button>
        </div>
      </form>
    </div>` : ""}
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
      <label>Пароль для входа</label><input id="emp-pass" type="text" placeholder="минимум 4 символа" />
      <label>Роль</label>
      <select id="emp-role">
        <option value="executor">Исполнитель</option>
        <option value="supervisor">Старший смены</option>
        <option value="order_manager">CRM-менеджер</option>
        <option value="admin">Админ</option>
      </select>
      <button type="button" class="btn btn-primary btn-block" onclick="empSave()">Сохранить</button>
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
            <button type="button" class="btn btn-ghost btn-sm" onclick='empEdit(${JSON.stringify(u.id)},${JSON.stringify(u.full_name||"")})'>Изменить</button>
            ${u.status !== "blocked" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" type="button" onclick="empBlock('${u.id}')">Блок</button>` : ""}
            ${u.status === "blocked" ? `<button class="btn btn-accent btn-sm" type="button" onclick="empUnblock('${u.id}')">Разблок</button>` : ""}
            ${u.status === "fired" ? `<button class="btn btn-accent btn-sm" type="button" onclick="empRestore('${u.id}')">Восстановить</button>` : ""}
            <button class="btn btn-ghost btn-sm" type="button" onclick="empHist('${u.id}')">История</button>
            ${u.status !== "fired" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" type="button" onclick="empDel('${u.id}')">Увол.</button>` : ""}
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
      birth_date: null,
      role: document.getElementById("emp-role").value,
      password: document.getElementById("emp-pass").value.trim() || null,
    })});
    toast(`Создан ${r.id}, пароль: ${r.password}`);
    render();
  } catch (e) { toast(e.message, true); }
};

window._empEditId = null;
window.empEdit = (id, name) => {
  window._empEditId = id;
  window._empEditName = name || "";
  page = "employees";
  render();
};
window.empEditCancel = () => {
  window._empEditId = null;
  render();
};
window.empEditSave = async (id) => {
  try {
    const nameEl = document.getElementById("edit-name");
    const passEl = document.getElementById("edit-pass");
    const roleEl = document.getElementById("edit-role");
    if (!nameEl) { toast("Форма не найдена", true); return; }
    const body = { full_name: nameEl.value.trim() };
    if (!body.full_name) { toast("Укажите ФИО", true); return; }
    const pwd = passEl ? passEl.value.trim() : "";
    const role = roleEl ? roleEl.value : "";
    if (pwd) body.password = pwd;
    if (role) body.role = role;
    await api("/employees/" + id, { method: "PATCH", body: JSON.stringify(body) });
    window._empEditId = null;
    window._empEditName = "";
    toast("Сохранено");
    render();
  } catch (e) { toast(e.message || "Ошибка сохранения", true); }
};
window.empBlock = (id) => {
  window._empBlockId = id;
  render();
};
window.empBlockCancel = () => { window._empBlockId = null; render(); };
window.empBlockSave = async (id) => {
  const reason = (document.getElementById("block-reason")?.value || "").trim();
  if (!reason) { toast("Нужна причина", true); return; }
  try {
    toast((await api("/employees/" + id + "/block", { method: "POST", body: JSON.stringify({ reason }) })).message);
    window._empBlockId = null;
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
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
            <button class="btn btn-ghost btn-sm" onclick="empEdit('${u.id}','${nameSafe}')">Изменить</button>
            ${u.status !== "blocked" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" type="button" onclick="empBlock('${u.id}')">Блокировать</button>` : ""}
            ${u.status === "blocked" ? `<button class="btn btn-accent btn-sm" type="button" onclick="empUnblock('${u.id}')">Разблок</button>` : ""}
            ${u.status === "fired" ? `<button class="btn btn-accent btn-sm" type="button" onclick="empRestore('${u.id}')">Восстановить</button>` : ""}
            <button class="btn btn-ghost btn-sm" type="button" onclick="empHist('${u.id}')">История</button>
            ${u.status !== "fired" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" type="button" onclick="empDel('${u.id}')">Увол.</button>` : ""}
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
        <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
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
      <button class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
    <div class="card">
      <div class="card-title">Справочники</div>
      <button class="btn btn-ghost btn-block" onclick="page='eans';render()">EAN</button>
      <button class="btn btn-ghost btn-block" onclick="page='points';render()">Точки передачи</button>
      <button class="btn btn-ghost btn-block" onclick="page='cells';render()">Ячейки</button>
      <button class="btn btn-ghost btn-block" onclick="page='bags';render()">Сумки</button>
      <button class="btn btn-ghost btn-block" onclick="page='receive';render()">Приёмка</button>
    </div>
    <div class="card">
      <div class="card-title">Доли по заказам (%)</div>
      <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0.5rem">Действует на новые заказы. Сумма = 100.</p>
      <label>Исполнитель</label><input id="pct-ex" type="number" min="0" max="100" />
      <label>CRM-менеджер</label><input id="pct-mg" type="number" min="0" max="100" />
      <label>Домовой</label><input id="pct-co" type="number" min="0" max="100" />
      <button class="btn btn-primary btn-block" onclick="financeSavePct()">Сохранить доли</button>
    </div>
    <div class="card">
      <div class="card-title">Штраф</div>
      <label>Учётка</label><input id="fine-user" placeholder="us000003" />
      <label>Сумма ₽</label><input id="fine-amount" type="number" min="1" />
      <label>За что</label><input id="fine-reason" />
      <button type="button" class="btn btn-danger btn-block" onclick="fineCreate()">Назначить</button>
    </div>
    <div class="card">
      <div class="card-title">Резервная копия</div>
      <button type="button" class="btn btn-primary btn-block" onclick="downloadBackup()">Скачать файл</button>
      <button type="button" class="btn btn-accent btn-block" style="margin-top:0.5rem" onclick="sendBackupTg()">В Telegram</button>
      <label style="margin-top:0.75rem;display:block">Восстановить из файла</label>
      <input type="file" id="restore-file" accept=".json,application/json" />
      <button type="button" class="btn btn-danger btn-block" style="margin-top:0.5rem" onclick="restoreBackup()">Восстановить</button>
      <p id="tg-status" style="color:var(--muted);font-size:0.8rem;margin-top:0.5rem"></p>
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
    <div class="page-h"><h1>Печать ШК</h1></div>
    <div class="card">
      <label for="qr-code">Код</label>
      <input id="qr-code" name="qr-code" type="text" inputmode="text"
        placeholder="dd… / sumka… / 11 цифр / us…"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
        style="font-size:16px;-webkit-user-select:text;user-select:text;"
        onkeydown="if(event.key==='Enter'){event.preventDefault();qrShow();}" />
      <button type="button" class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="qrShow()">Сформировать</button>
    </div>
    <div id="qr-out" style="margin-top:1rem"></div>`;
}

function dmApi(data, scale) {
  scale = scale || 5;
  return "https://bwipjs-api.metafloor.com/?bcid=datamatrix&text=" + encodeURIComponent(data) + "&scale=" + scale + "&padding=2";
}
function qrApi(data, size) {
  size = size || 120;
  return "https://api.qrserver.com/v1/create-qr-code/?size=" + size + "x" + size + "&margin=4&data=" + encodeURIComponent(data);
}
function barcodeApi(data) {
  return "https://bwipjs-api.metafloor.com/?bcid=code128&text=" + encodeURIComponent(data) + "&scale=5&height=22&includetext=false";
}

window.qrShow = function () {
  var el = document.getElementById("qr-code");
  var code = (el && el.value || "").trim();
  if (!code) { toast("Введите код", true); return; }
  var c = code.toLowerCase();
  var html = "";
  // DD — крупные Data Matrix (как 3 QR на сумке по ширине)
  if (/^dd\d{8}$/i.test(c)) {
    var top = c.slice(0, 6);
    var bot = c.slice(6);
    html = '<div class="card label-sheet" style="background:#fff;color:#000;max-width:480px;margin:0 auto;text-align:center;padding:22px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:14px">'
      + '<img src="' + dmApi(c, 5) + '" alt="dm" style="width:110px;height:110px;object-fit:contain" />'
      + '<div style="font-size:1.05rem;font-weight:800;letter-spacing:0.05em">ДОМОВОЙ</div>'
      + '<img src="' + dmApi(c, 5) + '" alt="dm" style="width:110px;height:110px;object-fit:contain" /></div>'
      + '<div style="font-size:2.15rem;font-weight:900;margin-top:18px;line-height:1.05">' + top + '<br>' + bot + '</div></div>'
      + '<p style="text-align:center;color:var(--muted);font-size:0.85rem;margin-top:0.75rem">Зажми этикетку → сохранить</p>';
  } else if (/^\d{11}$/.test(code)) {
    html = '<div class="card" style="max-width:480px;margin:0 auto">'
      + '<label for="ship-from">Склад-отправитель</label>'
      + '<input id="ship-from" value="001066" style="font-size:16px" inputmode="numeric" />'
      + '<label for="ship-to">Склад-получатель</label>'
      + '<input id="ship-to" value="001067" style="font-size:16px" inputmode="numeric" />'
      + '<button type="button" class="btn btn-accent btn-block" style="margin-top:0.75rem" onclick="qrShowShip(\'' + code + '\')">Показать этикетку</button></div>'
      + '<div id="ship-label-out" style="margin-top:1rem"></div>';
    setTimeout(function(){ window.qrShowShip(code); }, 40);
  } else if (/^sumka\d{5}$/i.test(c)) {
    html = '<div class="card label-sheet" style="background:#fff;color:#000;max-width:480px;margin:0 auto;padding:22px;text-align:center">'
      + '<div style="font-size:1.85rem;font-weight:900;margin-bottom:12px">' + c + '</div>'
      + '<img src="' + barcodeApi(c) + '" style="width:100%;height:96px;object-fit:contain" />'
      + '<div style="display:flex;justify-content:center;gap:14px;margin-top:16px">'
      + '<img src="' + qrApi(c, 120) + '" width="120" height="120" />'
      + '<img src="' + qrApi(c, 120) + '" width="120" height="120" />'
      + '<img src="' + qrApi(c, 120) + '" width="120" height="120" /></div></div>'
      + '<p style="text-align:center;color:var(--muted);font-size:0.85rem;margin-top:0.75rem">Сумка · сохрани в галерею</p>';
  } else {
    html = '<div class="card" style="text-align:center;max-width:380px;margin:0 auto">'
      + '<img src="' + qrApi(code, 300) + '" width="300" height="300" style="background:#fff;border-radius:12px;padding:10px;margin:0 auto;display:block" />'
      + '<div style="font-size:1.2rem;font-weight:700;margin-top:1rem">' + code + '</div></div>';
  }
  document.getElementById("qr-out").innerHTML = html;
  setTimeout(function(){ if (typeof recoverLayout === "function") recoverLayout(); }, 50);
};

window.qrShowShip = function (code) {
  var from = (document.getElementById("ship-from") && document.getElementById("ship-from").value || "001066").trim();
  var to = (document.getElementById("ship-to") && document.getElementById("ship-to").value || "").trim();
  var box = document.getElementById("ship-label-out") || document.getElementById("qr-out");
  box.innerHTML =
    '<div class="card label-sheet" style="background:#fff;color:#000;max-width:480px;margin:0 auto;padding:22px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px">'
    + '<img src="' + dmApi(code, 5) + '" style="width:110px;height:110px;object-fit:contain" />'
    + '<div style="font-size:1.05rem;font-weight:800;letter-spacing:0.06em">ДОМОВОЙ</div>'
    + '<img src="' + dmApi(code, 5) + '" style="width:110px;height:110px;object-fit:contain" /></div>'
    + '<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin:16px 0">'
    + '<div style="font-size:1.7rem;font-weight:900">' + from + '</div>'
    + '<div style="font-size:1.9rem;font-weight:900">→</div>'
    + '<div style="font-size:1.7rem;font-weight:900">' + (to || "—") + '</div></div>'
    + '<div style="font-size:1.3rem;font-style:italic;text-align:center;margin:8px 0">Поставка</div>'
    + '<div style="font-size:1.5rem;font-weight:800;text-align:center;margin:12px 0;letter-spacing:0.04em">' + code + '</div>'
    + '<img src="' + barcodeApi(code) + '" style="width:100%;height:96px;object-fit:contain" /></div>'
    + '<p style="text-align:center;color:var(--muted);font-size:0.85rem;margin-top:0.75rem">Зажми → сохранить</p>';
  setTimeout(function(){ if (typeof recoverLayout === "function") recoverLayout(); }, 50);
};


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
  // отключено: без фона /api/tsd/signals — меньше 429, без звука/вибрации о новых заказах
  if (signalTimer) { clearInterval(signalTimer); signalTimer = null; }
}

if (token && user) {
  api("/me").then(u => { user = u; sessionStorage.setItem("dv_user", JSON.stringify(u)); show("app"); startSignalPoll(); }).catch(logout);
} else {
  show("login");
}


async function renderCabinet() {
  const d = await api("/finance/cabinet");
  if (d.role === "order_manager") {
    const pill = (st) => {
      if (st === "done") return "pill-ok";
      if (st === "cancelled") return "pill-wait";
      if (["issued","assembling","awaiting_assembly","ready","completion_pending"].includes(st)) return "pill-work";
      return "pill-wait";
    };
    return `
      <div class="page-h">
        <h1>Личный кабинет</h1>
        <p style="color:var(--muted);margin-top:0.25rem">Здравствуйте, ${d.full_name}! · <span style="color:var(--primary)">Активен</span></p>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Мои заказы</div><div class="value">${d.brought}</div></div>
        <div class="stat-card"><div class="label">Выполнено</div><div class="value">${d.done}</div></div>
        <div class="stat-card"><div class="label">Мой заработок</div><div class="value lime">${(d.earned||0).toLocaleString("ru-RU")} ₽</div></div>
        <div class="stat-card"><div class="label">Ожидает выплаты</div><div class="value">${(d.awaiting_payout||0).toLocaleString("ru-RU")} ₽</div></div>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:0.5rem">Мои разделы</div>
        <ul class="menu-list">
          <li><button type="button" onclick="page='orders';render()">Создать заказ</button></li>
          <li><button type="button" onclick="go('orderHistory')">История заказов</button></li>
          <li><button type="button" onclick="page='fines';render()">Штрафы${d.open_fines ? " · " + d.open_fines + " ₽" : ""}</button></li>
          <li><button type="button" onclick="page='profile';render()">Профиль</button></li>
        </ul>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem">Последние заказы</div>
        ${d.orders && d.orders.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Заказ</th><th>Сумма</th><th>Статус</th></tr></thead>
          <tbody>${d.orders.map(o => `<tr>
            <td><strong>${o.id}</strong><br><small style="color:var(--muted)">${o.address || ""}</small></td>
            <td>${o.payment_amount != null ? Number(o.payment_amount).toLocaleString("ru-RU") + " ₽" : "—"}</td>
            <td><span class="pill ${pill(o.status)}">${o.status_label || o.status}</span></td>
          </tr>`).join("")}</tbody></table></div>` : "<p style='color:var(--muted)'>Нет заказов</p>"}
      </div>`;
  }
  // executor
  const pill2 = (st) => {
    if (st === "done") return "pill-ok";
    if (st === "issued" || st === "completion_pending") return "pill-work";
    return "pill-wait";
  };
  return `
    <div class="page-h">
      <h1>Личный кабинет</h1>
      <p style="color:var(--muted);margin-top:0.25rem">Здравствуйте, ${d.full_name}!</p>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Активные</div><div class="value">${d.active || 0}</div></div>
      <div class="stat-card"><div class="label">Выполнено</div><div class="value">${d.done || 0}</div></div>
      <div class="stat-card"><div class="label">Мой заработок</div><div class="value lime">${(d.earned||0).toLocaleString("ru-RU")} ₽</div></div>
      <div class="stat-card"><div class="label">Ожидает выплаты</div><div class="value">${(d.awaiting_payout||0).toLocaleString("ru-RU")} ₽</div></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:0.5rem">Мои разделы</div>
      <ul class="menu-list">
        <li><button type="button" onclick="go('home')">Мои заказы</button></li>
        <li><button type="button" onclick="go('orderHistory')">История заказов</button></li>
        <li><button type="button" onclick="page='fines';render()">Штрафы${d.open_fines ? " · " + d.open_fines + " ₽" : ""}</button></li>
        <li><button type="button" onclick="page='profile';render()">Профиль</button></li>
      </ul>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:0.75rem">Последние заказы</div>
      ${d.orders && d.orders.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Заказ</th><th>Сумма</th><th>Статус</th></tr></thead>
        <tbody>${d.orders.map(o => `<tr>
          <td><strong>${o.id}</strong><br><small style="color:var(--muted)">${o.address || ""}</small></td>
          <td>${o.payment_amount != null ? Number(o.payment_amount).toLocaleString("ru-RU") + " ₽" : "—"}</td>
          <td><span class="pill ${pill2(o.status)}">${o.status_label || o.status}</span></td>
        </tr>`).join("")}</tbody></table></div>` : "<p style='color:var(--muted)'>Нет заказов</p>"}
    </div>`;
}


async function renderPayouts() {
  const [rows, fines] = await Promise.all([
    api("/finance/payouts"),
    api("/finance/fines").catch(() => []),
  ]);
  const openFines = (fines || []).filter(f => f.status === "open");
  const fmt = (n) => Number(n || 0).toLocaleString("ru-RU") + " ₽";
  return `
    <div class="page-h"><h1>Выплаты</h1></div>
    ${rows.length ? rows.map(r => `
      <div class="card">
        <div style="font-weight:800;font-size:1.05rem;margin-bottom:0.75rem">${r.full_name || r.user_id}</div>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Заработано</th>
            <th>Штраф</th>
            <th>Выплачено</th>
          </tr></thead>
          <tbody><tr>
            <td>${fmt(r.earned != null ? r.earned : r.gross)}</td>
            <td>${fmt(r.fines)}</td>
            <td>${fmt(r.paid)}</td>
          </tr></tbody>
        </table></div>
        ${(r.to_pay || 0) > 0 ? `<button type="button" class="btn btn-primary btn-block" style="margin-top:0.75rem" onclick="doPayout('${r.user_id}')">Выплатить ${fmt(r.to_pay)}</button>` : ""}
      </div>
    `).join("") : `<div class="card"><p style="color:var(--muted);margin:0">Нет данных</p></div>`}

    <div class="card">
      <div class="card-title">Штрафы</div>
      ${openFines.length ? openFines.map(f => `
        <div style="padding:0.75rem 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:700">${f.full_name || f.user_id}</div>
          <div style="margin-top:0.25rem">${Number(f.amount).toLocaleString("ru-RU")} ₽ · ${f.reason || "—"}</div>
          <button type="button" class="btn btn-ghost btn-block" style="margin-top:0.5rem" onclick="cancelFine(${f.id})">Отменить штраф</button>
        </div>
      `).join("") : `<p style="color:var(--muted);margin:0.5rem 0 0">Нет активных штрафов</p>`}
    </div>

    <button type="button" class="btn btn-ghost btn-block" onclick="downloadFinanceCsv()">Скачать CSV</button>`;
}
window.cancelFine = async (id) => {
  if (!confirm("Отменить этот штраф?")) return;
  try {
    toast((await api("/finance/fines/" + id + "/cancel", { method: "POST" })).message);
    render();
  } catch (e) { toast(e.message, true); }
};
window.doPayout = async (uid) => {
  if (!confirm("Подтвердить выплату?")) return;
  try { toast((await api("/finance/payouts/" + uid, { method: "POST" })).message); render(); }
  catch (e) { toast(e.message, true); }
};
window.downloadFinanceCsv = async () => {
  try {
    const res = await fetch("/api/finance/export.csv", { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Ошибка выгрузки");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "domovoy-finance.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Файл скачан");
  } catch (e) { toast(e.message, true); }
};


async function renderMgrRating() {
  let d = {};
  try { d = await api("/admin/dashboard"); } catch (e) {
    return `<div class="page-h"><h1>Рейтинг менеджеров</h1></div><div class="error">${e.message}</div>`;
  }
  const rows = d.manager_rating || [];
  return `
    <div class="page-h"><h1>Рейтинг менеджеров</h1>
      <button type="button" class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Менеджер</th><th>Заказы</th><th>Выполнено</th><th>Комиссия</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.full_name}<br><small style="color:var(--muted)">${r.user_id}</small></td>
        <td>${r.orders}</td>
        <td>${r.done}</td>
        <td style="font-weight:700;color:var(--primary)">${Number(r.commission||0).toLocaleString("ru-RU")} ₽</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="card"><p style="color:var(--muted);margin:0">Нет данных</p></div>`}`;
}

async function renderExRating() {
  let d = {};
  try { d = await api("/admin/dashboard"); } catch (e) {
    return `<div class="page-h"><h1>Рейтинг исполнителей</h1></div><div class="error">${e.message}</div>`;
  }
  const rows = d.executor_rating || [];
  return `
    <div class="page-h"><h1>Рейтинг исполнителей</h1>
      <button type="button" class="btn btn-ghost btn-sm" onclick="go('home')">Назад</button></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Исполнитель</th><th>Активные</th><th>Выполнено</th><th>Заработано</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.full_name}<br><small style="color:var(--muted)">${r.user_id}</small></td>
        <td>${r.active || 0}</td>
        <td>${r.done}</td>
        <td style="font-weight:700;color:var(--primary)">${Number(r.commission||0).toLocaleString("ru-RU")} ₽</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="card"><p style="color:var(--muted);margin:0">Нет данных</p></div>`}`;
}

async function renderCrmReport() {
  const d = await api("/finance/crm-report");
  return `
    <div class="page-h"><h1>Отчёт по CRM</h1>
      <p style="color:var(--muted)">Месяц ${d.month_key} · доли ${d.pct.pct_executor}/${d.pct.pct_manager}/${d.pct.pct_company}</p></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Менеджеров</div><div class="value">${d.managers_count}</div></div>
      <div class="stat-card"><div class="label">Всего заявок</div><div class="value">${d.total_orders}</div></div>
      <div class="stat-card"><div class="label">Выполнено заказов</div><div class="value">${d.total_done}</div></div>
      <div class="stat-card"><div class="label">Комиссии менеджерам</div><div class="value lime">${Number(d.total_manager_commission||0).toLocaleString("ru-RU")} ₽</div></div>
    </div>
    <div class="card">
      <div class="label" style="color:var(--muted);font-size:0.8rem">Домовой · заработано за месяц</div>
      <div class="value lime" style="font-size:1.85rem;font-weight:800;margin-top:0.25rem">${Number(d.company_earned_month||0).toLocaleString("ru-RU")} ₽</div>
    </div>
    <div class="card" style="margin-top:1rem">
      <div class="card-title">Рейтинг менеджеров</div>
      ${d.rating.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Менеджер</th><th>Заказы</th><th>Комиссия</th></tr></thead>
        <tbody>${d.rating.map(r => `<tr>
          <td>${r.full_name}</td><td>${r.orders}</td><td>${r.commission} ₽</td>
        </tr>`).join("")}</tbody></table></div>` : "<p style='color:var(--muted)'>Нет данных</p>"}
    </div>
    <div class="card" style="margin-top:1rem">
      <div class="card-title">История месяцев (Домовой)</div>
      ${d.company_history && d.company_history.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Месяц</th><th>Сумма</th><th>Заказов</th></tr></thead>
        <tbody>${d.company_history.map(h => `<tr>
          <td>${h.month_key}</td><td>${h.amount} ₽</td><td>${h.orders_count || "—"}</td>
        </tr>`).join("")}</tbody></table></div>` : "<p style='color:var(--muted)'>Пока нет закрытых месяцев</p>"}
    </div>`;
}

async function renderMyFines() {
  const rows = await api("/finance/fines/my");
  const st = (s) => s === "open" ? "Активен" : s === "cancelled" ? "Отменён" : "Учтён";
  return `
    <div class="page-h"><h1>Штрафы</h1></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Сумма</th><th>За что</th><th>Статус</th></tr></thead>
      <tbody>${rows.map(f => `<tr>
        <td style="font-weight:700">${Number(f.amount).toLocaleString("ru-RU")} ₽</td>
        <td>${f.reason || "—"}</td>
        <td>${st(f.status)}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="card"><p style="color:var(--muted);margin:0">Штрафов нет</p></div>`}`;
}


window.financeSavePct = async () => {
  try {
    const r = await api("/finance/settings", { method: "POST", body: JSON.stringify({
      pct_executor: parseInt(document.getElementById("pct-ex").value, 10),
      pct_manager: parseInt(document.getElementById("pct-mg").value, 10),
      pct_company: parseInt(document.getElementById("pct-co").value, 10),
    })});
    toast("Доли сохранены: " + r.pct_executor + "/" + r.pct_manager + "/" + r.pct_company);
  } catch (e) { toast(e.message, true); }
};

window.fineCreate = async () => {
  try {
    const r = await api("/finance/fines", { method: "POST", body: JSON.stringify({
      user_id: document.getElementById("fine-user").value.trim(),
      amount: parseInt(document.getElementById("fine-amount").value, 10),
      reason: document.getElementById("fine-reason").value.trim(),
    })});
    toast(r.message); render();
  } catch (e) { toast(e.message, true); }
};

window.restoreBackup = async () => {
  const inp = document.getElementById("restore-file");
  if (!inp || !inp.files || !inp.files[0]) {
    toast("Выберите JSON-файл бэкапа", true);
    return;
  }
  if (!confirm("Восстановить данные из файла? Текущие записи с теми же ID будут перезаписаны.")) return;
  try {
    const text = await inp.files[0].text();
    JSON.parse(text); // проверка
    const res = await fetch("/api/admin/restore", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: text,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || ("Ошибка " + res.status));
    toast(data.message || "Восстановлено");
    inp.value = "";
  } catch (e) { toast(e.message || String(e), true); }
};


window.sendBackupTg = async () => {
  try {
    const r = await api("/admin/backup-telegram", { method: "POST" });
    toast(r.message || "Отправлено в Telegram");
    if (typeof window.loadTgStatus === "function") window.loadTgStatus();
  } catch (e) { toast(e.message || String(e), true); }
};

window.loadTgStatus = async () => {
  const el = document.getElementById("tg-status");
  if (!el) return;
  try {
    const s = await api("/admin/telegram-status");
    el.textContent = s.chat_id
      ? ("Telegram: ок · последний " + (s.last_backup_day || "—"))
      : ("Напишите /start боту " + (s.bot || "@Domovoi_rezerv_kopi_bot"));
  } catch (e) {
    el.textContent = "";
  }
};

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") recoverLayout();
});
window.addEventListener("pageshow", function () { recoverLayout(); });
window.addEventListener("orientationchange", function () {
  setTimeout(recoverLayout, 200);
});


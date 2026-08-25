const TOKEN_KEY = "lane_token";

const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const formRegister = document.getElementById("form-register");
const formLogin = document.getElementById("form-login");
const tabRegister = document.getElementById("tab-register");
const tabLogin = document.getElementById("tab-login");
const gateError = document.getElementById("gate-error");
const deskError = document.getElementById("desk-error");
const shell = document.querySelector(".shell");
const panel = document.querySelector(".panel");

function showGateError(message) {
  gateError.hidden = !message;
  gateError.textContent = message || "";
}

function showDeskError(message) {
  deskError.hidden = !message;
  deskError.textContent = message || "";
}

function setTab(which) {
  const register = which === "register";
  tabRegister.classList.toggle("on", register);
  tabLogin.classList.toggle("on", !register);
  formRegister.classList.toggle("hidden", !register);
  formLogin.classList.toggle("hidden", register);
  showGateError("");
}

function formatApiError(data, fallback) {
  const detail = data && data.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && detail[0].msg) return detail[0].msg;
  return fallback;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    throw new Error(formatApiError(data, res.statusText));
  }
  return data;
}

function hideViews() {
  document.getElementById("view-store").classList.add("hidden");
  document.getElementById("view-customer").classList.add("hidden");
  document.getElementById("view-rider").classList.add("hidden");
}

function renderMenu(listEl, items, { editable = false, orderable = false, storeId = null } = {}) {
  listEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "static";
    empty.textContent = "No items yet.";
    listEl.appendChild(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "static";
    const label = document.createElement("span");
    label.textContent = `${item.name} · ₹${item.price_rupees}`;
    li.appendChild(label);
    if (editable) {
      const stock = document.createElement("input");
      stock.type = "number";
      stock.min = "0";
      stock.value = String(item.stock);
      stock.className = "stock-edit";
      stock.title = "Stock";
      stock.addEventListener("change", async () => {
        showDeskError("");
        try {
          await api(`/stores/${storeId}/items/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ stock: Number(stock.value) }),
          });
        } catch (err) {
          showDeskError(err.message);
        }
      });
      li.appendChild(stock);
    } else if (orderable) {
      const qty = document.createElement("input");
      qty.type = "number";
      qty.min = "0";
      qty.max = String(item.stock);
      qty.value = "0";
      qty.className = "stock-edit";
      qty.dataset.itemId = String(item.id);
      qty.title = `${item.stock} left`;
      li.appendChild(qty);
    } else {
      const left = document.createElement("span");
      left.textContent = `${item.stock} left`;
      li.appendChild(left);
    }
    listEl.appendChild(li);
  }
}

const NEXT_ACTIONS = {
  placed: [
    ["accepted", "Accept"],
    ["rejected", "Reject"],
  ],
  accepted: [["preparing", "Preparing"]],
};

const RIDER_NEXT = {
  preparing: [["out_for_delivery", "Out"]],
  out_for_delivery: [["delivered", "Delivered"]],
};

let liveSocket = null;
let currentRole = null;

function setLive(on) {
  const flag = document.getElementById("live-flag");
  flag.textContent = on ? "live" : "offline";
  flag.classList.toggle("live", on);
}

function disconnectLive() {
  if (liveSocket) {
    liveSocket.close();
    liveSocket = null;
  }
  setLive(false);
}

function connectLive() {
  disconnectLive();
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  liveSocket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  liveSocket.onopen = () => setLive(true);
  liveSocket.onclose = () => setLive(false);
  liveSocket.onmessage = async () => {
    try {
      if (currentRole === "store") await loadStoreDesk();
      if (currentRole === "customer") await refreshCustomerOrders();
      if (currentRole === "rider") await loadRiderDesk();
      await loadAlerts();
    } catch {
      /* ignore refresh races */
    }
  };
}

function renderOrders(listEl, orders, { storeActions = false, riderClaim = false, riderActions = false } = {}) {
  listEl.innerHTML = "";
  if (!orders.length) {
    const empty = document.createElement("li");
    empty.className = "static";
    empty.textContent = "No orders yet.";
    listEl.appendChild(empty);
    return;
  }
  for (const order of orders) {
    const li = document.createElement("li");
    li.className = "static";
    const summary = order.lines.map((line) => `${line.quantity}× ${line.name}`).join(", ");
    const riderBit = order.rider_user_id ? ` · rider ${order.rider_user_id}` : "";
    const text = document.createElement("span");
    text.textContent = `#${order.id} ${order.status}${riderBit} · ₹${order.total_rupees} · ${summary}`;
    li.appendChild(text);
    if (storeActions) {
      for (const [status, label] of NEXT_ACTIONS[order.status] || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ghost tight";
        btn.textContent = label;
        btn.addEventListener("click", () => decideOrder(order.id, status));
        li.appendChild(btn);
      }
    }
    if (riderClaim) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost tight";
      btn.textContent = "Claim";
      btn.addEventListener("click", () => claimOrder(order.id));
      li.appendChild(btn);
    }
    if (riderActions) {
      for (const [status, label] of RIDER_NEXT[order.status] || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ghost tight";
        btn.textContent = label;
        btn.addEventListener("click", () => riderMove(order.id, status));
        li.appendChild(btn);
      }
    }
    listEl.appendChild(li);
  }
}

async function decideOrder(orderId, status) {
  showDeskError("");
  try {
    await api(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadStoreDesk();
    await loadAlerts();
  } catch (err) {
    showDeskError(err.message);
  }
}

async function claimOrder(orderId) {
  showDeskError("");
  try {
    await api(`/orders/${orderId}/claim`, { method: "POST" });
    await loadRiderDesk();
    await loadAlerts();
  } catch (err) {
    showDeskError(err.message);
  }
}

async function riderMove(orderId, status) {
  showDeskError("");
  try {
    await api(`/orders/${orderId}/rider`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadRiderDesk();
    await loadAlerts();
  } catch (err) {
    showDeskError(err.message);
  }
}

async function loadAlerts() {
  const flag = document.getElementById("relay-flag");
  const list = document.getElementById("relay-jobs");
  if (!flag || !list) return;
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch("/alerts", { headers, signal: ac.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(formatApiError(data, res.statusText));
    flag.textContent =
      data.relay === "offline"
        ? "Relay is offline. Orders still work; alerts will catch up later."
        : "Relay is live. Same event is not emailed twice (idempotency key).";
    list.innerHTML = "";
    if (!data.jobs.length) {
      const empty = document.createElement("li");
      empty.className = "static";
      empty.textContent = "No alerts yet for this role. Change an order status, then wait a second.";
      list.appendChild(empty);
      return;
    }
    for (const job of data.jobs) {
      const li = document.createElement("li");
      li.className = "static";
      const err = job.last_error ? ` · ${job.last_error}` : "";
      li.textContent = `${job.state} · ${job.body} (${job.attempts} tries)${err}`;
      list.appendChild(li);
    }
  } catch {
    flag.textContent = "Relay is offline or slow. Open http://localhost:8001/health — orders still work.";
  } finally {
    clearTimeout(timer);
  }
}

async function loadRiderDesk() {
  showDeskError("");
  const board = await api("/orders/board");
  renderOrders(document.getElementById("rider-available"), board.available, { riderClaim: true });
  renderOrders(document.getElementById("rider-mine"), board.mine, { riderActions: true });
}

async function loadStoreDesk() {
  const formStore = document.getElementById("form-store");
  const board = document.getElementById("store-board");
  showDeskError("");
  try {
    const store = await api("/stores/me");
    formStore.classList.add("hidden");
    board.classList.remove("hidden");
    document.getElementById("store-name").textContent = store.name;
    const items = await api(`/stores/${store.id}/items`);
    renderMenu(document.getElementById("store-menu"), items, {
      editable: true,
      storeId: store.id,
    });
    formStore.dataset.storeId = String(store.id);
    const inbox = await api("/orders/inbox");
    renderOrders(document.getElementById("store-orders"), inbox, { storeActions: true });
  } catch (err) {
    formStore.classList.remove("hidden");
    board.classList.add("hidden");
    if (err.message !== "No store yet") showDeskError(err.message);
  }
}

async function refreshCustomerOrders() {
  const mine = await api("/orders/me");
  renderOrders(document.getElementById("customer-orders"), mine);
}

async function loadCustomerStores() {
  const list = document.getElementById("store-list");
  const menuWrap = document.getElementById("customer-menu");
  list.classList.remove("hidden");
  menuWrap.classList.add("hidden");
  showDeskError("");
  const stores = await api("/stores");
  await refreshCustomerOrders();
  list.innerHTML = "";
  if (!stores.length) {
    const empty = document.createElement("li");
    empty.className = "static";
    empty.textContent = "No stores yet. Sign in as a store role and open one.";
    list.appendChild(empty);
    return;
  }
  for (const store of stores) {
    const li = document.createElement("li");
    li.textContent = store.name;
    li.addEventListener("click", async () => {
      showDeskError("");
      const items = await api(`/stores/${store.id}/items`);
      list.classList.add("hidden");
      menuWrap.classList.remove("hidden");
      document.getElementById("customer-store-name").textContent = store.name;
      menuWrap.dataset.storeId = String(store.id);
      renderMenu(document.getElementById("customer-items"), items, { orderable: true });
      await refreshCustomerOrders();
      await loadAlerts();
    });
    list.appendChild(li);
  }
}

async function showDesk(user) {
  gate.classList.add("hidden");
  desk.classList.remove("hidden");
  shell.classList.add("work");
  panel.classList.add("work");
  document.getElementById("desk-email").textContent = user.email;
  document.getElementById("desk-role").textContent = user.role;
  document.getElementById("desk-id").textContent = String(user.id);
  hideViews();
  showDeskError("");
  currentRole = user.role;
  if (user.role === "store") {
    document.getElementById("view-store").classList.remove("hidden");
    await loadStoreDesk();
  } else if (user.role === "customer") {
    document.getElementById("view-customer").classList.remove("hidden");
    await loadCustomerStores();
  } else if (user.role === "rider") {
    document.getElementById("view-rider").classList.remove("hidden");
    await loadRiderDesk();
  } else {
    document.getElementById("view-rider").classList.remove("hidden");
  }
  connectLive();
  await loadAlerts();
}

function showGate() {
  desk.classList.add("hidden");
  gate.classList.remove("hidden");
  shell.classList.remove("work");
  panel.classList.remove("work");
  hideViews();
}

async function restoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const me = await api("/auth/me");
    await showDesk(me);
  } catch {
    localStorage.removeItem(TOKEN_KEY);
  }
}

tabRegister.addEventListener("click", () => setTab("register"));
tabLogin.addEventListener("click", () => setTab("login"));

formRegister.addEventListener("submit", async (event) => {
  event.preventDefault();
  showGateError("");
  const body = Object.fromEntries(new FormData(formRegister).entries());
  try {
    await api("/auth/register", { method: "POST", body: JSON.stringify(body) });
    const session = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
    localStorage.setItem(TOKEN_KEY, session.access_token);
    const me = await api("/auth/me");
    await showDesk(me);
  } catch (err) {
    showGateError(err.message);
  }
});

formLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  showGateError("");
  const body = Object.fromEntries(new FormData(formLogin).entries());
  try {
    const session = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
    localStorage.setItem(TOKEN_KEY, session.access_token);
    const me = await api("/auth/me");
    await showDesk(me);
  } catch (err) {
    showGateError(err.message);
  }
});

document.getElementById("btn-logout").addEventListener("click", () => {
  disconnectLive();
  currentRole = null;
  localStorage.removeItem(TOKEN_KEY);
  showGate();
  setTab("login");
});

document.getElementById("form-store").addEventListener("submit", async (event) => {
  event.preventDefault();
  showDeskError("");
  const body = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api("/stores", { method: "POST", body: JSON.stringify({ name: body.name }) });
    await loadStoreDesk();
    await loadAlerts();
  } catch (err) {
    showDeskError(err.message);
  }
});

document.getElementById("form-item").addEventListener("submit", async (event) => {
  event.preventDefault();
  showDeskError("");
  const storeId = document.getElementById("form-store").dataset.storeId;
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api(`/stores/${storeId}/items`, {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        price_rupees: Number(data.price_rupees),
        stock: Number(data.stock),
      }),
    });
    event.target.reset();
    event.target.price_rupees.value = "80";
    event.target.stock.value = "10";
    await loadStoreDesk();
    await loadAlerts();
  } catch (err) {
    showDeskError(err.message);
  }
});

document.getElementById("btn-place-order").addEventListener("click", async () => {
  showDeskError("");
  const wrap = document.getElementById("customer-menu");
  const storeId = Number(wrap.dataset.storeId);
  const qtys = [...wrap.querySelectorAll("input[data-item-id]")];
  const items = qtys
    .map((input) => ({ menu_item_id: Number(input.dataset.itemId), quantity: Number(input.value) }))
    .filter((line) => line.quantity > 0);
  if (!items.length) {
    showDeskError("Pick at least one item.");
    return;
  }
  try {
    await api("/orders", { method: "POST", body: JSON.stringify({ store_id: storeId, items }) });
    const menu = await api(`/stores/${storeId}/items`);
    renderMenu(document.getElementById("customer-items"), menu, { orderable: true });
    await refreshCustomerOrders();
    await loadAlerts();
  } catch (err) {
    showDeskError(err.message);
  }
});

document.getElementById("btn-back-stores").addEventListener("click", async () => {
  await loadCustomerStores();
});

restoreSession();

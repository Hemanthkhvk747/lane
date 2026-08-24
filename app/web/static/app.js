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

function renderOrders(listEl, orders, { storeActions = false } = {}) {
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
    const text = document.createElement("span");
    text.textContent = `#${order.id} ${order.status} · ₹${order.total_rupees} · ${summary}`;
    li.appendChild(text);
    if (storeActions && order.status === "placed") {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "ghost tight";
      accept.textContent = "Accept";
      accept.addEventListener("click", () => decideOrder(order.id, "accepted"));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "ghost tight";
      reject.textContent = "Reject";
      reject.addEventListener("click", () => decideOrder(order.id, "rejected"));
      li.appendChild(accept);
      li.appendChild(reject);
    }
    listEl.appendChild(li);
  }
}

async function decideOrder(orderId, status) {
  showDeskError("");
  try {
    await api(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadStoreDesk();
  } catch (err) {
    showDeskError(err.message);
  }
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

async function loadCustomerStores() {
  const list = document.getElementById("store-list");
  const menuWrap = document.getElementById("customer-menu");
  list.classList.remove("hidden");
  menuWrap.classList.add("hidden");
  showDeskError("");
  const stores = await api("/stores");
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
      const mine = await api("/orders/me");
      renderOrders(document.getElementById("customer-orders"), mine);
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
  if (user.role === "store") {
    document.getElementById("view-store").classList.remove("hidden");
    await loadStoreDesk();
  } else if (user.role === "customer") {
    document.getElementById("view-customer").classList.remove("hidden");
    await loadCustomerStores();
  } else {
    document.getElementById("view-rider").classList.remove("hidden");
  }
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
    const mine = await api("/orders/me");
    renderOrders(document.getElementById("customer-orders"), mine);
  } catch (err) {
    showDeskError(err.message);
  }
});

document.getElementById("btn-back-stores").addEventListener("click", async () => {
  await loadCustomerStores();
});

restoreSession();

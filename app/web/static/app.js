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

function renderMenu(listEl, items, { editable = false, storeId = null } = {}) {
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
    li.className = editable ? "static" : "static";
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
    } else {
      const qty = document.createElement("span");
      qty.textContent = `${item.stock} left`;
      li.appendChild(qty);
    }
    listEl.appendChild(li);
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
      renderMenu(document.getElementById("customer-items"), items);
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

document.getElementById("btn-back-stores").addEventListener("click", async () => {
  await loadCustomerStores();
});

restoreSession();

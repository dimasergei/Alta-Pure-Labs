const state = {
  group: "All",
  query: "",
  sort: "name",
  cart: loadCart(),
};

const $ = (sel) => document.querySelector(sel);
const money = (n) => `$${n.toFixed(0)}`;

function loadCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("pp-cart") || "[]");
    if (!Array.isArray(cart)) return [];
    return cart.map((line) => {
      const product = CATALOG.find((item) => item.id === line.id);
      const variant = product?.variants.find((item) => item.size === line.size);
      return variant ? { ...line, name: product.name, price: variant.price } : line;
    });
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem("pp-cart", JSON.stringify(state.cart));
  renderCartCount();
}

function fromPrice(product) {
  return Math.min(...product.variants.map((v) => v.price));
}

function vialSvg(product) {
  const label = product.name.length > 16 ? product.name.slice(0, 15) + "…" : product.name;
  const size = product.variants[0].size;
  const duo = product.variants.length > 1;
  const tone = product.category === "capsules" ? "#e7d7b8" : product.category === "supplies" ? "#d5e4ef" : "#d7f3ee";
  return `
    <svg viewBox="0 0 360 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${product.name}">
      <defs>
        <linearGradient id="g-${product.id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#243936"/>
          <stop offset="1" stop-color="#101816"/>
        </linearGradient>
        <linearGradient id="gl-${product.id}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.15"/>
          <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.7"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0.12"/>
        </linearGradient>
      </defs>
      <rect width="360" height="280" rx="18" fill="url(#g-${product.id})"/>
      <ellipse cx="180" cy="232" rx="92" ry="16" fill="#000" opacity="0.28"/>
      ${duo ? vial(118, product.id, tone, label, size) + vial(214, product.id, "#f4f1ea", label, product.variants[product.variants.length - 1].size) : vial(180, product.id, tone, label, size)}
    </svg>`;
}

function vial(cx, id, tone, label, size) {
  const x = cx - 38;
  return `
    <g>
      <rect x="${cx - 16}" y="42" width="32" height="14" rx="3" fill="#151515"/>
      <rect x="${cx - 10}" y="56" width="20" height="16" fill="url(#gl-${id})"/>
      <rect x="${x}" y="72" width="76" height="132" rx="14" fill="url(#gl-${id})" stroke="#ffffff" stroke-opacity="0.35"/>
      <rect x="${x + 8}" y="132" width="60" height="60" rx="8" fill="${tone}" opacity="0.9"/>
      <rect x="${x + 10}" y="86" width="56" height="40" rx="4" fill="#f7f5f1"/>
      <text x="${cx}" y="104" text-anchor="middle" font-family="Plus Jakarta Sans, Arial" font-size="8" font-weight="700" fill="#143832">${escapeXml(label)}</text>
      <text x="${cx}" y="118" text-anchor="middle" font-family="Plus Jakarta Sans, Arial" font-size="8" fill="#1c7a73">${escapeXml(size)}</text>
    </g>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function visibleProducts() {
  const q = state.query.trim().toLowerCase();
  let items = CATALOG.filter((product) => {
    const inGroup = state.group === "All" || product.group === state.group;
    const hay = `${product.name} ${product.group} ${product.variants.map((v) => v.size).join(" ")}`.toLowerCase();
    return inGroup && (!q || hay.includes(q));
  });
  items.sort((a, b) => {
    if (state.sort === "price-asc") return fromPrice(a) - fromPrice(b) || a.name.localeCompare(b.name);
    if (state.sort === "price-desc") return fromPrice(b) - fromPrice(a) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name) || fromPrice(a) - fromPrice(b);
  });
  return items;
}

function renderFilters() {
  $("#filters").innerHTML = GROUPS.map(
    (group) => `<button class="chip" type="button" role="tab" aria-selected="${group === state.group}" data-group="${escapeXml(group)}">${group}</button>`
  ).join("");
}

function productCardMarkup(product) {
  return `
      <article class="card">
        <button class="shot" type="button" data-open="${product.id}">${vialSvg(product)}</button>
        <div class="meta">
          <span class="group">${product.group}</span>
          <h3>${product.name}</h3>
          <span class="muted">${product.variants.map((variant) => variant.size).join(" · ")}</span>
          <div class="price-row">
            <div>
              <span class="from">FROM</span>
              <span class="price">${money(fromPrice(product))}</span>
            </div>
            <button class="add" type="button" data-open="${product.id}" aria-label="Choose ${escapeXml(product.name)}">
              <svg viewBox="0 0 24 24"><path d="M6 7h15l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6L5.2 4H3"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg>
            </button>
          </div>
        </div>
      </article>`;
}

function renderFeatured() {
  const featuredIds = new Set(["retatrutide", "tirzepatide", "semaglutide"]);
  $("#featured-grid").innerHTML = CATALOG
    .filter((product) => featuredIds.has(product.id))
    .map(productCardMarkup)
    .join("");
}

function renderSpotlight() {
  const product = CATALOG.find((item) => item.id === "bpc-157");
  if (!product) throw new Error("Spotlight product is missing from the catalog.");
  $("#spotlight-name").textContent = product.name;
  $("#spotlight-price").textContent = `From ${money(fromPrice(product))} · ${product.variants.map((variant) => variant.size).join(" / ")}`;
  $("#spotlight-open").dataset.open = product.id;
}

function renderGrid() {
  const items = visibleProducts();
  const noun = items.length === 1 ? "product" : "products";
  $("#result-count").textContent = `${items.length} ${noun}`;
  if (!items.length) {
    $("#grid").innerHTML = `<p class="empty">No products match that search.</p>`;
    return;
  }
  $("#grid").innerHTML = items.map(productCardMarkup).join("");
}

function renderCartCount() {
  const count = state.cart.reduce((sum, line) => sum + line.qty, 0);
  const badge = $("#cart-count");
  badge.hidden = count === 0;
  badge.textContent = String(count);
  $("#open-cart").setAttribute("aria-label", count ? `Open cart, ${count} items` : "Open cart");
}

function renderCart() {
  const lines = $("#cart-lines");
  if (!state.cart.length) {
    lines.innerHTML = `<p class="muted">Your cart is empty.</p>`;
  } else {
    lines.innerHTML = state.cart
      .map(
        (line) => `
        <div class="cart-line">
          <div>
            <strong>${line.name}</strong>
            <span class="muted">${line.size} · ${money(line.price)} each</span>
          </div>
          <div class="qty">
            <button type="button" data-dec="${line.key}" aria-label="Decrease">−</button>
            <input value="${line.qty}" aria-label="Quantity" readonly />
            <button type="button" data-inc="${line.key}" aria-label="Increase">+</button>
          </div>
        </div>`
      )
      .join("");
  }
  const total = state.cart.reduce((sum, line) => sum + line.price * line.qty, 0);
  $("#cart-total").textContent = money(total);
  $("#checkout").disabled = state.cart.length === 0;
}

function openProduct(id) {
  const product = CATALOG.find((item) => item.id === id);
  if (!product) return;
  $("#product-body").innerHTML = `
    <header class="dialog-head">
      <div>
        <p class="eyebrow">${product.group}</p>
        <h2>${product.name}</h2>
      </div>
      <button class="icon-btn" value="cancel" type="submit" aria-label="Close">×</button>
    </header>
    <div class="product-layout">
      ${vialSvg(product)}
      <div>
        <p>${product.blurb}</p>
        <p class="fine">Wholesale unit price. Labeling and pick-and-pack included. Shipping is not included. Research use only — not for human consumption.</p>
        <div class="variants">
          ${product.variants
            .map(
              (variant, index) => `
              <div class="variant">
                <div>
                  <strong>${variant.size}</strong>
                  <span class="muted">per unit</span>
                </div>
                <strong>${money(variant.price)}</strong>
                <button class="pill pill-dark" type="button" data-add="${product.id}" data-index="${index}">Add</button>
              </div>`
            )
            .join("")}
        </div>
      </div>
    </div>`;
  $("#product-dialog").showModal();
}

function addVariant(productId, index) {
  const product = CATALOG.find((item) => item.id === productId);
  const variant = product.variants[index];
  const key = `${product.id}:${variant.size}`;
  const existing = state.cart.find((line) => line.key === key);
  if (existing) existing.qty += 1;
  else state.cart.push({ key, id: product.id, name: product.name, size: variant.size, price: variant.price, qty: 1 });
  saveCart();
  $("#product-dialog").close();
  renderCart();
  $("#cart-dialog").showModal();
}

function changeQty(key, delta) {
  const line = state.cart.find((item) => item.key === key);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter((item) => item.key !== key);
  saveCart();
  renderCart();
}

function renderCheckoutSummary() {
  const total = state.cart.reduce((sum, line) => sum + line.price * line.qty, 0);
  $("#checkout-summary").innerHTML = `
    ${state.cart
      .map((line) => `<div class="line"><span>${line.name} · ${line.size} × ${line.qty}</span><strong>${money(line.price * line.qty)}</strong></div>`)
      .join("")}
    <div class="totals"><span>Subtotal</span><strong>${money(total)}</strong></div>
    <p class="fine">Shipping not included.</p>`;
}

function initGate() {
  if (sessionStorage.getItem("pp-age") === "yes") {
    $("#gate").hidden = true;
    return;
  }
  $("#gate").hidden = false;
  $("#gate-yes").addEventListener("click", () => {
    sessionStorage.setItem("pp-age", "yes");
    $("#gate").hidden = true;
  });
  $("#gate-no").addEventListener("click", () => {
    $("#gate-block").hidden = false;
  });
}

function init() {
  renderFilters();
  renderFeatured();
  renderSpotlight();
  renderGrid();
  renderCartCount();
  initGate();

  $("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    state.group = button.dataset.group;
    renderFilters();
    renderGrid();
  });
  $(".hero-actions").addEventListener("click", (event) => {
    const link = event.target.closest("[data-select-group]");
    if (!link) return;
    state.group = link.dataset.selectGroup;
    renderFilters();
    renderGrid();
  });
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderGrid();
  });
  $("#open-search").addEventListener("click", () => $("#search").focus());
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGrid();
  });
  document.querySelector("main").addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open]");
    if (opener) openProduct(opener.dataset.open);
  });
  $("#product-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    addVariant(button.dataset.add, Number(button.dataset.index));
  });
  $("#open-cart").addEventListener("click", () => {
    renderCart();
    $("#cart-dialog").showModal();
  });
  $("#cart-lines").addEventListener("click", (event) => {
    const inc = event.target.closest("[data-inc]");
    const dec = event.target.closest("[data-dec]");
    if (inc) changeQty(inc.dataset.inc, 1);
    if (dec) changeQty(dec.dataset.dec, -1);
  });
  $("#checkout").addEventListener("click", () => {
    if (!state.cart.length) return;
    renderCheckoutSummary();
    $("#cart-dialog").close();
    $("#checkout-dialog").showModal();
  });
  $("#close-checkout").addEventListener("click", () => $("#checkout-dialog").close());
  $("#checkout-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const total = state.cart.reduce((sum, line) => sum + line.price * line.qty, 0);
    const count = state.cart.reduce((sum, line) => sum + line.qty, 0);
    state.cart = [];
    saveCart();
    $("#checkout-dialog").querySelector(".dialog-body").innerHTML = `
      <div class="confirm">
        <p class="eyebrow">Request received</p>
        <h2>Order noted</h2>
        <p>${escapeXml(data.get("name"))}, ${count} units totaling ${money(total)} are ready for fulfillment review.</p>
        <p class="fine">Shipping is not included. No payment was processed. Research use only.</p>
        <button class="pill pill-dark" type="button" id="done">Back to catalog</button>
      </div>`;
    $("#done").addEventListener("click", () => {
      $("#checkout-dialog").close();
      location.reload();
    });
  });
}

init();

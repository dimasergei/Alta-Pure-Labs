// Embedded previews may have an opaque origin and disallow browser storage.
// Keep the app usable there without changing persistence in normal browsers.
const memoryStorage = { localStorage: new Map(), sessionStorage: new Map() };

function readStorage(type, key) {
  try {
    return window[type].getItem(key);
  } catch {
    return memoryStorage[type].get(key) ?? null;
  }
}

function writeStorage(type, key, value) {
  try {
    window[type].setItem(key, value);
  } catch {
    memoryStorage[type].set(key, value);
  }
}

const state = {
  group: "All",
  query: "",
  sort: "name",
  limit: 12,
  cart: loadCart(),
  selectedVariants: {},
};

const $ = (sel) => document.querySelector(sel);
const money = (n) => `$${n.toFixed(0)}`;

function loadCart() {
  try {
    const cart = JSON.parse(readStorage("localStorage", "pp-cart") || "[]");
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
  writeStorage("localStorage", "pp-cart", JSON.stringify(state.cart));
  renderCartCount();
}

function fromPrice(product) {
  return Math.min(...product.variants.map((v) => v.price));
}

function vialSvg(product) {
  const label = product.name.length > 16 ? product.name.slice(0, 15) + "…" : product.name;
  const size = product.variants[0].size;
  const duo = product.variants.length > 1;
  const tone = product.category === "capsules" ? "#e1e5e7" : product.category === "supplies" ? "#dbe6ee" : "#deebe6";
  return `
    <svg viewBox="0 0 360 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${product.name}">
      <title>${escapeXml(product.name)} product illustration</title>
      ${duo ? vial(118, product.id, tone, label, size) + vial(214, product.id, "#f4f1ea", label, product.variants[product.variants.length - 1].size) : vial(180, product.id, tone, label, size)}
    </svg>`;
}

function vial(cx, id, tone, label, size) {
  const x = cx - 38;
  return `
    <g>
      <rect x="${cx - 25}" y="35" width="50" height="20" rx="3" fill="#bac3c3"/>
      <rect x="${cx - 21}" y="36" width="42" height="5" rx="2" fill="#e6ebea"/>
      <rect x="${cx - 19}" y="55" width="38" height="18" fill="#d6deda"/>
      <rect x="${x}" y="70" width="76" height="157" rx="15" fill="#d8e1df"/>
      <rect x="${x + 6}" y="72" width="64" height="150" rx="12" fill="#edf1ef"/>
      <rect x="${x + 12}" y="80" width="5" height="132" rx="2" fill="white" opacity=".85"/>
      <rect x="${x + 3}" y="115" width="70" height="86" fill="#fff"/>
      <rect x="${x + 3}" y="172" width="70" height="29" fill="${tone}"/>
      <image class="vial-brand" href="assets/brand-label.webp" x="${cx - 30}" y="122" width="60" height="16" aria-label="AltaPure Labs" />
      <text x="${cx}" y="155" text-anchor="middle" font-family="Plus Jakarta Sans, Arial" font-size="8" font-weight="700" fill="#143832">${escapeXml(label)}</text>
      <text x="${cx}" y="190" text-anchor="middle" font-family="Plus Jakarta Sans, Arial" font-size="9" fill="#143832">${escapeXml(size)}</text>
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

function productImageUrl(product, variant = product.variants[0]) {
  return PRODUCT_IMAGES[product.id]?.[variant.size] || PRODUCT_IMAGE_FALLBACKS[product.id] || "";
}

function productImage(product, variant = product.variants[0]) {
  const image = productImageUrl(product, variant);
  if (!image) return "";

  return `
    <img
      class="product-photo"
      src="${image}"
      alt="${escapeXml(`${product.name} ${variant.size} product label`)}"
      loading="lazy"
      onerror="this.style.display='none'"
    />`;
}

function productCardMarkup(product) {
  const selectedVariant = product.variants.find((variant) => variant.size === state.selectedVariants[product.id]) || product.variants[0];
  return `
      <article class="card" data-group="${escapeXml(product.group)}">
        <button class="shot" type="button" data-open="${product.id}" data-size="${escapeXml(selectedVariant.size)}" aria-label="View ${escapeXml(product.name)} ${escapeXml(selectedVariant.size)} details">
          ${vialSvg(product)}
          ${productImage(product, selectedVariant)}
        </button>
        <div class="meta">
          <span class="group">${product.group}</span>
          <h3>${product.name}</h3>
          <label class="variant-select-label">
            <span class="sr">Choose ${escapeXml(product.name)} dosage</span>
            <select class="variant-select" data-variant-select="${product.id}" aria-label="Choose ${escapeXml(product.name)} dosage">
              ${product.variants.map((variant) => `<option value="${escapeXml(variant.size)}" ${variant.size === selectedVariant.size ? "selected" : ""}>${escapeXml(variant.size)}</option>`).join("")}
            </select>
          </label>
          <div class="price-row">
            <div>
              <span class="from">From</span>
              <span class="price">${money(fromPrice(product))}</span>
            </div>
            <button class="add" type="button" data-open="${product.id}" data-size="${escapeXml(selectedVariant.size)}" aria-label="Choose ${escapeXml(product.name)}">
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
    $("#show-more").hidden = true;
    return;
  }
  $("#grid").innerHTML = items.slice(0, state.limit).map(productCardMarkup).join("");
  $("#show-more").hidden = state.limit >= items.length;
  $("#show-more").textContent = `Show more products (${items.length - state.limit} remaining)`;
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

function openProduct(id, selectedSize) {
  const product = CATALOG.find((item) => item.id === id);
  if (!product) return;
  const selectedVariant = product.variants.find((variant) => variant.size === selectedSize) || product.variants[0];
  state.selectedVariants[product.id] = selectedVariant.size;
  $("#product-body").innerHTML = `
    <header class="dialog-head">
      <div>
        <p class="product-category">${product.group}</p>
        <h2>${product.name}</h2>
        <p class="fine">Selected dosage: <strong>${escapeXml(selectedVariant.size)}</strong></p>
      </div>
      <button class="icon-btn" value="cancel" type="submit" aria-label="Close">×</button>
    </header>
    <div class="product-layout">
      <div class="product-photo-wrap">
        ${vialSvg(product)}
        ${productImage(product, selectedVariant)}
      </div>
      <div>
        <p>${product.blurb}</p>
        <p class="fine">Wholesale unit price. Labeling and pick-and-pack included. Shipping is not included. Research use only. Not for human consumption.</p>
        <div class="variants">
          ${product.variants
            .map(
              (variant, index) => `
              <div class="variant" ${variant.size === selectedVariant.size ? 'data-selected="true"' : ""}>
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
  if (readStorage("sessionStorage", "pp-age") === "yes") {
    $("#gate").hidden = true;
    return;
  }
  $("#gate").hidden = false;
  $("#gate-yes").addEventListener("click", () => {
    writeStorage("sessionStorage", "pp-age", "yes");
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
    state.limit = 12;
    renderFilters();
    renderGrid();
  });
  document.querySelector("main").addEventListener("click", (event) => {
    const link = event.target.closest("[data-select-group]");
    if (!link) return;
    state.group = link.dataset.selectGroup;
    state.query = "";
    state.limit = 12;
    $("#search").value = "";
    renderFilters();
    renderGrid();
  });
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    state.limit = 12;
    renderGrid();
  });
  $("#open-search").addEventListener("click", () => $("#search").focus());
  $("#show-more").addEventListener("click", () => {
    state.limit += 12;
    renderGrid();
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.limit = 12;
    renderGrid();
  });
  document.querySelector("main").addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open]");
    if (opener) openProduct(opener.dataset.open, opener.dataset.size || state.selectedVariants[opener.dataset.open]);
  });
  const updateSelectedImage = (event) => {
    const select = event.target.closest("[data-variant-select]");
    if (!select) return;
    const product = CATALOG.find((item) => item.id === select.dataset.variantSelect);
    const variant = product?.variants.find((item) => item.size === select.value);
    if (!product || !variant) return;
    state.selectedVariants[product.id] = variant.size;
    const card = select.closest(".card");
    const photo = card?.querySelector(".product-photo");
    if (photo) {
      photo.src = productImageUrl(product, variant);
      photo.alt = `${product.name} ${variant.size} product label`;
      photo.style.display = "block";
    }
    const opener = card?.querySelector(".shot");
    if (opener) {
      opener.dataset.size = variant.size;
      opener.setAttribute("aria-label", `View ${product.name} ${variant.size} details`);
    }
    const addControl = card?.querySelector(".add[data-open]");
    if (addControl) addControl.dataset.size = variant.size;
  };
  $("#grid").addEventListener("change", updateSelectedImage);
  $("#featured-grid").addEventListener("change", updateSelectedImage);
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
        <h2>Summary prepared</h2>
        <p>${escapeXml(data.get("name"))}, your local summary contains ${count} ${count === 1 ? "unit" : "units"} totaling ${money(total)}.</p>
        <p class="fine">This summary stays in your browser. No order was sent and no payment was processed. Shipping is not included. Research use only.</p>
        <button class="pill pill-dark" type="button" id="done">Back to catalog</button>
      </div>`;
    $("#done").addEventListener("click", () => {
      $("#checkout-dialog").close();
      location.reload();
    });
  });
}

init();

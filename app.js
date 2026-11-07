(() => {
  "use strict";

  const products = window.PRODUCTS.map((product, index) => ({
    ...product,
    id: `${product.name}-${product.variant}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    code: `AP-${String(index + 1).padStart(3, "0")}`
  }));
  const byId = new Map(products.map((product) => [product.id, product]));
  const elements = {
    grid: document.querySelector("#product-grid"),
    search: document.querySelector("#search-input"),
    sort: document.querySelector("#sort-select"),
    summary: document.querySelector("#results-summary"),
    allCount: document.querySelector("#all-count"),
    empty: document.querySelector("#empty-state"),
    cartCount: document.querySelector("#cart-count"),
    dialog: document.querySelector("#inquiry-dialog"),
    dialogContent: document.querySelector("#inquiry-content"),
    toast: document.querySelector("#toast"),
    nav: document.querySelector("#primary-navigation"),
    menuToggle: document.querySelector(".menu-toggle")
  };
  let activeCategory = "All";
  let toastTimer;
  let cart = loadCart();

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem("alta-pure-labs-inquiry") || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(
        Object.entries(saved).filter(([id, quantity]) =>
          byId.has(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 99
        )
      );
    } catch (error) {
      console.error("Could not restore the saved inquiry list.", error);
      showToast("Saved inquiry list could not be restored; starting with an empty list.");
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem("alta-pure-labs-inquiry", JSON.stringify(cart));
    } catch (error) {
      console.error("Could not save the inquiry list.", error);
      showToast("Your browser could not save this list. Keep this page open while you review it.");
    }
    updateCartCount();
  }

  function money(amount) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function productArt(product) {
    const name = escapeHtml(product.name);
    if (product.category === "Capsules") {
      return `<div class="product-art" data-kind="Capsules" aria-hidden="true"><div class="art-capsule"></div></div>`;
    }
    return `<div class="product-art" data-kind="${escapeHtml(product.category)}" data-name="${name}" aria-hidden="true">
      <div class="art-cap"></div><div class="art-neck"></div>
      <div class="art-bottle"><span>ALTA</span><i></i><small>RESEARCH<br>CATALOG</small></div>
    </div>`;
  }

  function renderProducts() {
    const query = elements.search.value.trim().toLowerCase();
    const sort = elements.sort.value;
    let visible = products.filter((product) =>
      (activeCategory === "All" || product.category === activeCategory) &&
      `${product.name} ${product.variant} ${product.category}`.toLowerCase().includes(query)
    );
    if (sort === "name") visible.sort((a, b) => a.name.localeCompare(b.name) || a.variant.localeCompare(b.variant));
    if (sort === "price-low") visible.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    if (sort === "price-high") visible.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
    if (sort === "featured") visible.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || products.indexOf(a) - products.indexOf(b));

    elements.grid.innerHTML = visible.map((product, index) => `
      <article class="product-card">
        <div class="product-visual" data-category="${escapeHtml(product.category)}">
          <span class="product-code">${escapeHtml(product.code)}</span>
          <span class="product-number">${String(index + 1).padStart(2, "0")} / ${String(visible.length).padStart(2, "0")}</span>
          ${productArt(product)}
          <span class="product-tag">${escapeHtml(product.category)}</span>
        </div>
        <div class="product-info">
          <div class="product-name-row"><h3 class="product-name">${escapeHtml(product.name)}</h3><span class="product-price">${money(product.price)}</span></div>
          <div class="product-meta"><span class="product-variant">${escapeHtml(product.variant)}</span><span>Per unit</span></div>
          <button class="add-button" type="button" data-add="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.name)} ${escapeHtml(product.variant)} to inquiry list">
            <span aria-hidden="true">+</span> Add to inquiry list
          </button>
        </div>
      </article>
    `).join("");

    elements.summary.textContent = `Showing ${visible.length} of ${products.length} catalog items`;
    elements.empty.hidden = visible.length > 0;
    elements.grid.hidden = visible.length === 0;
  }

  function updateCartCount() {
    const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
    elements.cartCount.textContent = String(count);
    elements.cartCount.setAttribute("aria-label", `${count} items in inquiry list`);
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
  }

  function cartTotal() {
    return Object.entries(cart).reduce((total, [id, quantity]) => total + byId.get(id).price * quantity, 0);
  }

  function renderInquiry() {
    const entries = Object.entries(cart).filter(([id, quantity]) => byId.has(id) && quantity > 0);
    if (entries.length === 0) {
      elements.dialogContent.innerHTML = `
        <div class="cart-empty">
          <strong>Your list is empty.</strong>
          <p>Explore the catalog and add items to request availability.</p>
          <button class="text-button" type="button" data-close-and-browse>Browse catalog <span aria-hidden="true">↗</span></button>
        </div>`;
      return;
    }

    const list = entries.map(([id, quantity]) => {
      const product = byId.get(id);
      return `<li class="cart-item">
        <div class="cart-item-name">${escapeHtml(product.name)}<span class="cart-item-sub">${escapeHtml(product.variant)} · ${money(product.price)} per unit</span></div>
        <div class="quantity-control" aria-label="Quantity">
          <button type="button" data-quantity="${escapeHtml(id)}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)} ${escapeHtml(product.variant)}">−</button>
          <span>${quantity}</span>
          <button type="button" data-quantity="${escapeHtml(id)}" data-change="1" aria-label="Add one ${escapeHtml(product.name)} ${escapeHtml(product.variant)}">+</button>
        </div>
        <span class="cart-item-price">${money(product.price * quantity)}</span>
      </li>`;
    }).join("");

    elements.dialogContent.innerHTML = `
      <ul class="cart-list">${list}</ul>
      <div class="cart-summary"><span>Catalog subtotal</span><span>${money(cartTotal())}</span></div>
      <p class="shipping-note">Listed catalog prices are per-unit wholesale prices. Shipping is not included. Availability and fulfillment terms are confirmed upon inquiry.</p>
      <button class="secondary-button" type="button" data-clear-list>Clear list</button>
      <form class="inquiry-form" id="inquiry-form">
        <h3>Request availability</h3>
        <label>Contact name<input name="name" autocomplete="name" required maxlength="100"></label>
        <label>Organization / institution<input name="organization" autocomplete="organization" required maxlength="140"></label>
        <label>Work email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
        <label>Additional notes (optional)<textarea name="notes" maxlength="1000"></textarea></label>
        <label class="research-check"><input name="researchOnly" type="checkbox" required>
          <span>I confirm this inquiry is solely for qualified research and laboratory purposes, and not for human or veterinary use.</span>
        </label>
        <button class="submit-inquiry" type="submit">Prepare availability request</button>
      </form>`;
  }

  function requestDocument(formData) {
    const request = {
      requestType: "Non-binding availability inquiry",
      submittedAt: new Date().toISOString(),
      contact: {
        name: formData.get("name").trim(),
        organization: formData.get("organization").trim(),
        email: formData.get("email").trim(),
        notes: formData.get("notes").trim()
      },
      researchUseAcknowledged: true,
      items: Object.entries(cart).map(([id, quantity]) => {
        const product = byId.get(id);
        return { name: product.name, packageSize: product.variant, quantity, unitPrice: product.price, lineTotal: product.price * quantity };
      }),
      catalogSubtotal: cartTotal(),
      notice: "This request is not an order. No payment has been collected. Availability, eligibility, shipping and fulfillment terms require separate confirmation."
    };
    return request;
  }

  function downloadRequest(request) {
    const content = JSON.stringify(request, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `alta-pure-labs-inquiry-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showConfirmation(request) {
    downloadRequest(request);
    elements.dialogContent.innerHTML = `
      <div class="request-confirmation">
        <span class="confirmation-mark" aria-hidden="true">✓</span>
        <h3>Your inquiry file is ready.</h3>
        <p>A JSON copy of your non-binding availability request has been downloaded. This page does not send your information, place an order, reserve products, or collect payment.</p>
        <button type="button" class="text-button request-download" data-download-again>Download request again <span aria-hidden="true">↗</span></button>
        <button type="button" class="secondary-button" data-finish>Return to catalog</button>
      </div>`;
    elements.dialogContent.dataset.request = JSON.stringify(request);
  }

  function openDialog() {
    renderInquiry();
    if (!elements.dialog.open) elements.dialog.showModal();
  }

  elements.grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const id = button.dataset.add;
    if (!byId.has(id)) return;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    saveCart();
    showToast(`${byId.get(id).name} added to your inquiry list.`);
  });

  document.querySelector(".category-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category;
    document.querySelectorAll(".category-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    renderProducts();
  });
  elements.search.addEventListener("input", renderProducts);
  elements.sort.addEventListener("change", renderProducts);
  document.querySelector("#clear-filters").addEventListener("click", () => {
    activeCategory = "All";
    elements.search.value = "";
    elements.sort.value = "featured";
    document.querySelectorAll(".category-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.category === "All"));
    renderProducts();
  });

  document.querySelector("#open-inquiry").addEventListener("click", openDialog);
  document.querySelector("#close-inquiry").addEventListener("click", () => elements.dialog.close());
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  elements.dialogContent.addEventListener("click", (event) => {
    const quantityButton = event.target.closest("[data-quantity]");
    if (quantityButton) {
      const id = quantityButton.dataset.quantity;
      const next = (cart[id] || 0) + Number(quantityButton.dataset.change);
      if (next <= 0) delete cart[id];
      else cart[id] = Math.min(99, next);
      saveCart();
      renderInquiry();
      return;
    }
    if (event.target.closest("[data-clear-list]")) {
      cart = {};
      saveCart();
      renderInquiry();
      showToast("Inquiry list cleared.");
      return;
    }
    if (event.target.closest("[data-close-and-browse]") || event.target.closest("[data-finish]")) {
      elements.dialog.close();
      if (event.target.closest("[data-close-and-browse]")) document.querySelector("#catalog").scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (event.target.closest("[data-download-again]")) {
      try {
        const request = JSON.parse(elements.dialogContent.dataset.request);
        downloadRequest(request);
      } catch (error) {
        console.error("Could not recreate the inquiry file.", error);
        showToast("The inquiry file could not be created again. Please submit a new request.");
      }
    }
  });
  elements.dialogContent.addEventListener("submit", (event) => {
    if (event.target.id !== "inquiry-form") return;
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const request = requestDocument(new FormData(event.target));
    showConfirmation(request);
  });

  elements.menuToggle.addEventListener("click", () => {
    const expanded = elements.menuToggle.getAttribute("aria-expanded") === "true";
    elements.menuToggle.setAttribute("aria-expanded", String(!expanded));
    elements.menuToggle.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
    elements.nav.classList.toggle("open", !expanded);
  });
  elements.nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      elements.nav.classList.remove("open");
      elements.menuToggle.setAttribute("aria-expanded", "false");
      elements.menuToggle.setAttribute("aria-label", "Open navigation");
    }
  });

  document.querySelector("#current-year").textContent = String(new Date().getFullYear());
  elements.allCount.textContent = `(${products.length})`;
  updateCartCount();
  renderProducts();
})();

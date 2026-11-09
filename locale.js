(function () {
  const currencies = ["USD", "CAD", "EUR", "GBP", "AUD"];
  const languages = ["en", "fr", "es"];
  const locales = { en: "en-US", fr: "fr-CA", es: "es-ES" };
  const translations = {
    en: {
      announcement:"Research use only. Pick-and-pack included. Shipping billed separately.", featured:"Featured", catalog:"Catalog", faq:"FAQ", account:"Account", currency:"Currency", language:"Language",
      heroTitle1:"Research, all", heroTitle2:"in one place.", heroDescription:"Research compounds and laboratory supplies. Explore the AltaPure catalog with clear, per-unit pricing.",
      shopCompounds:"Shop compounds", heroDisclaimer:"Laboratory research only. Not for human or animal use.", researchTitle:"A closer look at research.",
      researchDescription:"Explore peptides and compounds across the current catalog. Compare available sizes, then build your research request.",
      exploreCatalog:"Explore the catalog", featuredTitle:"Featured compounds.", viewAllProducts:"View all products", researchCatalog:"Research catalog",
      searchProducts:"Search products", searchPlaceholder:"Search compounds", categories:"Categories", sortProducts:"Sort products", cart:"Cart", checkout:"Review order",
      orderRequest:"Order request", localSummary:"This is a local order summary. No payment is processed.", name:"Name", email:"Email", organization:"Laboratory or organization",
      researchConfirmation:"I confirm this request is for laboratory research only and not for human consumption.", placeRequest:"Place request",
      pricesUSD:"Prices in USD", estimateNote:"Converted estimate · based on USD prices", rateUnavailable:"Live rates unavailable · showing USD",
      displayCurrencyNote:"Converted amounts are estimates based on USD catalog prices.", productSingular:"product", productPlural:"products",
      showMore:"Show more products ({count} remaining)", cartEmpty:"Your cart is empty.", openCart:"Open cart", openCartCount:"Open cart, {count} items",
      each:"each", decrease:"Decrease", increase:"Increase", quantity:"Quantity", selectedDosage:"Selected dosage", perUnit:"per unit", add:"Add",
      subtotal:"Subtotal", shippingNotIncluded:"Shipping not included.", All:"All", "GLP-1 & Metabolic":"GLP-1 & Metabolic",
      "Healing & Recovery":"Healing & Recovery", "Growth Hormone":"Growth Hormone", "Cognitive & Nootropic":"Cognitive & Nootropic",
      Longevity:"Longevity", "Cosmetic & Skin":"Cosmetic & Skin", "Sexual & Hormonal":"Sexual & Hormonal", "BAC Water & Supplies":"BAC Water & Supplies"
    },
    fr: {
      announcement:"Réservé à la recherche. Préparation incluse. Frais d’expédition facturés séparément.", featured:"En vedette", catalog:"Catalogue", faq:"FAQ", account:"Compte", currency:"Devise", language:"Langue",
      heroTitle1:"La recherche,", heroTitle2:"au même endroit.", heroDescription:"Composés de recherche et fournitures de laboratoire. Parcourez le catalogue AltaPure avec des prix clairs à l’unité.",
      shopCompounds:"Voir les composés", heroDisclaimer:"Recherche en laboratoire uniquement. Ne pas utiliser chez l’humain ou l’animal.", researchTitle:"Approfondir la recherche.",
      researchDescription:"Explorez les peptides et composés du catalogue actuel. Comparez les formats, puis préparez votre demande de recherche.",
      exploreCatalog:"Explorer le catalogue", featuredTitle:"Composés en vedette.", viewAllProducts:"Voir tous les produits", researchCatalog:"Catalogue de recherche",
      searchProducts:"Rechercher des produits", searchPlaceholder:"Rechercher des composés", categories:"Catégories", sortProducts:"Trier les produits", cart:"Panier", checkout:"Vérifier la commande",
      orderRequest:"Demande de commande", localSummary:"Ceci est un récapitulatif local. Aucun paiement n’est traité.", name:"Nom", email:"Courriel", organization:"Laboratoire ou organisme",
      researchConfirmation:"Je confirme que cette demande concerne uniquement la recherche en laboratoire et non la consommation humaine.", placeRequest:"Envoyer la demande",
      pricesUSD:"Prix en USD", estimateNote:"Estimation convertie · prix de base en USD", rateUnavailable:"Taux en direct indisponibles · affichage en USD",
      displayCurrencyNote:"Les montants convertis sont indicatifs et basés sur les prix du catalogue en USD.", productSingular:"produit", productPlural:"produits",
      showMore:"Afficher plus de produits ({count} restants)", cartEmpty:"Votre panier est vide.", openCart:"Ouvrir le panier", openCartCount:"Ouvrir le panier, {count} articles",
      each:"chacun", decrease:"Diminuer", increase:"Augmenter", quantity:"Quantité", selectedDosage:"Format sélectionné", perUnit:"par unité", add:"Ajouter",
      subtotal:"Sous-total", shippingNotIncluded:"Expédition non incluse.", All:"Tout", "GLP-1 & Metabolic":"GLP-1 et métabolisme",
      "Healing & Recovery":"Récupération", "Growth Hormone":"Hormone de croissance", "Cognitive & Nootropic":"Cognition et nootropiques",
      Longevity:"Longévité", "Cosmetic & Skin":"Cosmétique et peau", "Sexual & Hormonal":"Sexuel et hormonal", "BAC Water & Supplies":"Eau bactériostatique et fournitures"
    },
    es: {
      announcement:"Solo para investigación. Preparación incluida. Envío facturado por separado.", featured:"Destacados", catalog:"Catálogo", faq:"Preguntas frecuentes", account:"Cuenta", currency:"Moneda", language:"Idioma",
      heroTitle1:"Investigación,", heroTitle2:"todo en un solo lugar.", heroDescription:"Compuestos de investigación y suministros de laboratorio. Explore el catálogo de AltaPure con precios claros por unidad.",
      shopCompounds:"Ver compuestos", heroDisclaimer:"Solo para investigación de laboratorio. No apto para uso humano ni animal.", researchTitle:"Una mirada más cercana a la investigación.",
      researchDescription:"Explore los péptidos y compuestos del catálogo actual. Compare los tamaños disponibles y prepare su solicitud de investigación.",
      exploreCatalog:"Explorar el catálogo", featuredTitle:"Compuestos destacados.", viewAllProducts:"Ver todos los productos", researchCatalog:"Catálogo de investigación",
      searchProducts:"Buscar productos", searchPlaceholder:"Buscar compuestos", categories:"Categorías", sortProducts:"Ordenar productos", cart:"Carrito", checkout:"Revisar pedido",
      orderRequest:"Solicitud de pedido", localSummary:"Este es un resumen local. No se procesa ningún pago.", name:"Nombre", email:"Correo electrónico", organization:"Laboratorio u organización",
      researchConfirmation:"Confirmo que esta solicitud es únicamente para investigación de laboratorio y no para consumo humano.", placeRequest:"Enviar solicitud",
      pricesUSD:"Precios en USD", estimateNote:"Estimación convertida · precios base en USD", rateUnavailable:"Tipos de cambio no disponibles · mostrando USD",
      displayCurrencyNote:"Los importes convertidos son estimaciones basadas en los precios del catálogo en USD.", productSingular:"producto", productPlural:"productos",
      showMore:"Mostrar más productos ({count} restantes)", cartEmpty:"Su carrito está vacío.", openCart:"Abrir carrito", openCartCount:"Abrir carrito, {count} artículos",
      each:"cada uno", decrease:"Disminuir", increase:"Aumentar", quantity:"Cantidad", selectedDosage:"Tamaño seleccionado", perUnit:"por unidad", add:"Añadir",
      subtotal:"Subtotal", shippingNotIncluded:"Envío no incluido.", All:"Todos", "GLP-1 & Metabolic":"GLP-1 y metabolismo",
      "Healing & Recovery":"Recuperación", "Growth Hormone":"Hormona de crecimiento", "Cognitive & Nootropic":"Cognición y nootrópicos",
      Longevity:"Longevidad", "Cosmetic & Skin":"Cosmética y piel", "Sexual & Hormonal":"Sexual y hormonal", "BAC Water & Supplies":"Agua bacteriostática y suministros"
    }
  };
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let currency = currencies.includes(read("ap-currency","USD")) ? read("ap-currency","USD") : "USD";
  let language = languages.includes(read("ap-language","en")) ? read("ap-language","en") : "en";
  let rates = { USD:1 }, ratesLoaded = false;
  const listeners = new Set();
  const t = (key, fallback) => translations[language][key] || translations.en[key] || fallback || key;
  const notify = () => listeners.forEach((listener) => listener());
  const status = () => {
    const node = document.querySelector("#currency-status");
    if (!node) return;
    node.textContent = currency === "USD" ? t("pricesUSD","Prices in USD") : ratesLoaded ? t("estimateNote","Converted estimate · based on USD prices") : t("rateUnavailable","Live rates unavailable · showing USD");
  };
  const apply = () => {
    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n,node.textContent); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder,node.placeholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => node.setAttribute("aria-label",t(node.dataset.i18nAria,node.getAttribute("aria-label"))));
    const lang = document.querySelector("#language-select"), curr = document.querySelector("#currency-select");
    if (lang) lang.value = language;
    if (curr) curr.value = currency;
    status();
  };
  const loadRates = async () => {
    if (ratesLoaded) return true;
    try {
      const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD,EUR,GBP,AUD",{cache:"no-store"});
      if (!response.ok) throw new Error("Rate request failed");
      const data = await response.json();
      for (const code of currencies.filter((item) => item !== "USD")) if (!Number.isFinite(data.rates?.[code])) throw new Error("Incomplete rate response");
      rates = {USD:1,...data.rates}; ratesLoaded = true; return true;
    } catch { rates = {USD:1}; return false; }
  };
  const formatMoney = (amount) => {
    const code = ratesLoaded && rates[currency] ? currency : "USD";
    return new Intl.NumberFormat({en:"en-US",fr:"fr-CA",es:"es-ES"}[language],{style:"currency",currency:code,maximumFractionDigits:2}).format(amount*rates[code]);
  };
  const setCurrency = async (next) => {
    if (!currencies.includes(next)) return;
    if (next !== "USD" && !(await loadRates())) { currency="USD"; write("ap-currency",currency); apply(); notify(); return; }
    currency=next; write("ap-currency",currency); apply(); notify();
  };
  const setLanguage = (next) => { if (!languages.includes(next)) return; language=next; write("ap-language",language); apply(); notify(); };
  window.AltaLocale = {t,formatMoney,onChange:(listener)=>listeners.add(listener),setCurrency,setLanguage,get currency(){return currency;},get language(){return language;}};
  const currencySelect=document.querySelector("#currency-select"), languageSelect=document.querySelector("#language-select");
  if(currencySelect){currencySelect.value=currency;currencySelect.addEventListener("change",(event)=>setCurrency(event.target.value));}
  if(languageSelect){languageSelect.value=language;languageSelect.addEventListener("change",(event)=>setLanguage(event.target.value));}
  apply();
})();

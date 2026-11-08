function formatShippingAddress(orderName, address = {}) {
  return [
    orderName || address.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(", "),
    address.country
  ].filter(Boolean).join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { formatShippingAddress };
}

if (typeof window !== "undefined") {
  window.AltaPureAccountFormat = { formatShippingAddress };
}

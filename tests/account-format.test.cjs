const test = require("node:test");
const assert = require("node:assert/strict");
const { formatShippingAddress } = require("../account-format.js");

test("shipping address uses real newline characters in display order", () => {
  const value = formatShippingAddress("A. Customer", {
    name: "Ignored fallback", line1: "123 Research Way", line2: "Unit 4",
    city: "Hamilton", state: "ON", postal_code: "L8P 1A1", country: "Canada"
  });
  assert.equal(value, "A. Customer\n123 Research Way\nUnit 4\nHamilton, ON, L8P 1A1\nCanada");
  assert.equal(value.includes("\\n"), false);
});

test("shipping address omits missing fields without blank lines", () => {
  assert.equal(formatShippingAddress("", {
    name: "B. Customer", line1: "1 Main St", city: "Toronto", country: "Canada"
  }), "B. Customer\n1 Main St\nToronto\nCanada");
});

test("empty address returns an empty string", () => {
  assert.equal(formatShippingAddress("", {}), "");
});

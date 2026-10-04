import test from "node:test";
import assert from "node:assert/strict";
import { versionStatus, shopMismatches } from "./version.mjs";

test("a matching served version is fine", () => {
  assert.deepEqual(versionStatus("2026-07", "2026-07"), { ok: true, note: "Shopify served 2026-07" });
});

test("a different served version means the requested one is expired or unreleased", () => {
  const r = versionStatus("2025-01", "2026-01");
  assert.equal(r.ok, false);
  assert.match(r.note, /2025-01/);
  assert.match(r.note, /2026-01/);
});

test("a missing header cannot confirm anything", () => {
  assert.equal(versionStatus("2026-07", null).ok, false);
});

const config = { currency: "EUR", pricesIncludeTax: true };

test("matching shop and config give no problems", () => {
  assert.deepEqual(shopMismatches({ currencyCode: "EUR", taxesIncluded: true }, config), []);
});

test("currency mismatch says stop and ask", () => {
  const [p] = shopMismatches({ currencyCode: "USD", taxesIncluded: true }, config);
  assert.match(p, /USD/);
  assert.match(p, /ask the owner/);
});

test("tax mismatch points at the tax-inclusive step because the API cannot change it", () => {
  const [p] = shopMismatches({ currencyCode: "EUR", taxesIncluded: false }, config);
  assert.match(p, /tax-inclusive/);
});

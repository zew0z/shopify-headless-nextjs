import test from "node:test";
import assert from "node:assert/strict";
import { SCOPES, missingScopes, collectUserErrors } from "./admin-client.mjs";

test("collectUserErrors finds nested userErrors", () => {
  const data = { a: { userErrors: [{ message: "x" }] }, b: [{ c: { userErrors: [{ message: "y" }] } }] };
  assert.deepEqual(collectUserErrors(data).map((e) => e.message), ["x", "y"]);
});

test("collectUserErrors returns [] for clean data", () => {
  assert.deepEqual(collectUserErrors({ a: { userErrors: [] } }), []);
});

test("a write scope satisfies its read counterpart", () => {
  assert.deepEqual(missingScopes(["write_shipping", "read_locations"], SCOPES.shipping), []);
});

test("missing scopes are reported by name", () => {
  assert.deepEqual(missingScopes(["read_locations"], SCOPES.shipping), ["write_shipping"]);
});

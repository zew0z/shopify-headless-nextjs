import test from "node:test";
import assert from "node:assert/strict";
import { STEPS } from "./steps.mjs";
import { validateSteps } from "./engine.mjs";

test("registry is internally consistent", () => {
  assert.deepEqual(validateSteps(STEPS), []);
});

test("every step explains itself and every browser step has a human fallback", () => {
  for (const s of STEPS) {
    assert.ok(s.instructions.length > 20, `${s.id} needs instructions`);
    if (s.owner === "browser") assert.ok(/If the browser is unavailable/.test(s.instructions), `${s.id} needs a fallback`);
  }
});

test("money cannot be taken before tax, shipping, domain, emails and a browser run exist", () => {
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));
  const required = ["tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect", "email-templates-install", "email-sender"];
  for (const need of required) {
    assert.ok(byId["test-order"].needs.includes(need), `test-order must need ${need}`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { STEPS } from "./steps.mjs";
import { stepsForFramework } from "./framework-steps.mjs";
test("Astro guidance preserves every completion gate and the original Next instructions", () => {
  assert.equal(stepsForFramework(STEPS, "next"), STEPS);
  const astro = stepsForFramework(STEPS, "astro");
  assert.deepEqual(astro.map((s) => [s.id, s.needs]), STEPS.map((s) => [s.id, s.needs]));
  assert.match(astro.find((s) => s.id === "frontend-cart").instructions, /httpOnly/);
  assert.match(astro.find((s) => s.id === "frontend-catalogue").instructions, /\.astro/);
  assert.match(astro.find((s) => s.id === "analytics-check").instructions, /Do not mark/);
});

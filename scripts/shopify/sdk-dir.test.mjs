import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { findSdkDir } from "./sdk-dir.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

test("a src/ layout keeps the SDK in src/lib/shopify", () => {
  const root = makeFixture({ "src/lib/shopify/index.ts": "", "src/app/page.tsx": "" });
  assert.equal(findSdkDir(root), path.join(root, "src/lib/shopify"));
});

test("a root layout keeps the SDK in lib/shopify", () => {
  const root = makeFixture({ "lib/shopify/index.ts": "", "app/page.tsx": "" });
  assert.equal(findSdkDir(root), path.join(root, "lib/shopify"));
});

test("a repo without the SDK has none", () => {
  assert.equal(findSdkDir(makeFixture({ "app/page.tsx": "" })), null);
});

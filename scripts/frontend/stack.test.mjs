import test from "node:test";
import assert from "node:assert/strict";
import { detectStack } from "./stack.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const pkg = (deps) => ({ name: "received", dependencies: deps });

test("Next 16 with src/app is supported and keeps its code under src/", () => {
  const s = detectStack(makeFixture({ "package.json": pkg({ next: "^16.1.0", react: "19.2.0" }), "src/app/page.tsx": "" }));
  assert.equal(s.framework, "next");
  assert.equal(s.nextMajor, 16);
  assert.equal(s.router, "app");
  assert.equal(s.appRoot, "src/");
  assert.equal(s.supported, true);
});

test("Next 16 with app/ at the root is supported with no src/ prefix", () => {
  const s = detectStack(makeFixture({ "package.json": pkg({ next: "16.3.4" }), "app/page.tsx": "" }));
  assert.equal(s.appRoot, "");
  assert.equal(s.supported, true);
});

test("Next 15 must be upgraded first", () => {
  const s = detectStack(makeFixture({ "package.json": pkg({ next: "15.2.0" }), "app/page.tsx": "" }));
  assert.equal(s.supported, false);
  assert.match(s.reason, /upgrade.*16/i);
});

test("the Pages Router is not supported yet", () => {
  const s = detectStack(makeFixture({ "package.json": pkg({ next: "^16.0.0" }), "pages/index.tsx": "" }));
  assert.equal(s.router, "pages");
  assert.equal(s.supported, false);
  assert.match(s.reason, /Pages Router/);
});

test("Vite and Astro are recognised and stopped", () => {
  const vite = detectStack(makeFixture({ "package.json": { devDependencies: { vite: "^7.0.0" }, dependencies: { react: "19" } } }));
  assert.equal(vite.framework, "vite");
  assert.equal(vite.supported, false);
  const astro = detectStack(makeFixture({ "package.json": pkg({ astro: "^5.0.0" }) }));
  assert.equal(astro.framework, "astro");
  assert.equal(astro.supported, false);
});

test("no package.json means nothing can be said", () => {
  const s = detectStack(makeFixture({ "index.html": "<h1>hi</h1>" }));
  assert.equal(s.framework, "unknown");
  assert.equal(s.supported, false);
});

test("version ranges read their major version", () => {
  for (const range of ["^16", "~16.0.1", "16.x", ">=16.0.0"]) {
    const s = detectStack(makeFixture({ "package.json": pkg({ next: range }), "app/page.tsx": "" }));
    assert.equal(s.nextMajor, 16, range);
  }
});

test("'latest' reads the installed Next.js, and refuses when none is installed", () => {
  const installed = detectStack(
    makeFixture({ "package.json": pkg({ next: "latest" }), "app/page.tsx": "", "node_modules/next/package.json": { version: "16.2.0" } })
  );
  assert.equal(installed.nextMajor, 16);
  assert.equal(installed.supported, true);
  const unknown = detectStack(makeFixture({ "package.json": pkg({ next: "latest" }), "app/page.tsx": "" }));
  assert.equal(unknown.supported, false);
  assert.match(unknown.reason, /cannot tell the Next\.js version/);
});

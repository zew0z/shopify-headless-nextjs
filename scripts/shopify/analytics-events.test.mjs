import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { pageViewEvents, productViewEvents, addToCartEvents, sendToShopify, MONORAIL_URL } = await loadSdk("analytics-events");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/monorail-hydrogen-react.json", import.meta.url), "utf8"));
const VOLATILE = new Set(fixture.volatile);
const strip = (v) =>
  Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, strip(x)])) : v;

for (const [name, build] of [["pageView", pageViewEvents], ["productView", productViewEvents], ["addToCart", addToCartEvents]]) {
  test(`${name} events match what Shopify's own package sends`, () => {
    const { input, events } = fixture.cases[name];
    assert.deepEqual(strip(build(input)), events);
  });
}

test("events go to Shopify's analytics address as plain text", async () => {
  const calls = [];
  const ok = await sendToShopify(pageViewEvents(fixture.cases.pageView.input), async (url, init) => {
    calls.push({ url, init });
    return new Response("");
  });
  assert.equal(ok, true);
  assert.equal(calls[0].url, MONORAIL_URL);
  assert.equal(calls[0].url, fixture.cases.pageView.url);
  assert.equal(calls[0].init.headers["content-type"], "text/plain");
  assert.equal(JSON.parse(calls[0].init.body).events.length, 2);
});

test("a failed send never throws into the page", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const events = pageViewEvents(fixture.cases.pageView.input);
    assert.equal(await sendToShopify(events, async () => { throw new Error("offline"); }), false);
    assert.equal(await sendToShopify(events, async () => new Response("", { status: 500 })), false);
    assert.equal(await sendToShopify(events, async () => new Response(JSON.stringify({ result: [{ status: 400, message: "bad" }] }))), false);
  } finally {
    console.warn = warn;
  }
});

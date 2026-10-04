import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizeUrl, computeHmac, verifyCallback, redirectUri, runOAuth, SHOP_PATTERN } from "./oauth.mjs";

const secret = "client-secret";
const domain = "shop.myshopify.com";
const signed = (fields) => {
  const params = new URLSearchParams(fields);
  params.set("hmac", computeHmac(params, secret));
  return params;
};

test("the authorize URL carries client id, scopes, redirect and state", () => {
  const url = new URL(buildAuthorizeUrl({ domain, clientId: "id", scopes: ["write_products", "read_locations"], redirect: redirectUri(3456), state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://shop.myshopify.com/admin/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "write_products,read_locations");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3456/callback");
  assert.equal(url.searchParams.get("state"), "s1");
});

test("the hmac ignores the hmac field and the order of the others", () => {
  const a = computeHmac(new URLSearchParams("b=2&a=1&hmac=zzz"), secret);
  const b = computeHmac(new URLSearchParams("a=1&b=2"), secret);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("a correct callback is accepted and yields the code", () => {
  const query = signed({ code: "c1", shop: domain, state: "s1", timestamp: "1", host: "aG9zdA==" });
  assert.deepEqual(verifyCallback({ query, state: "s1", clientSecret: secret, domain }), { ok: true, code: "c1" });
});

test("a wrong state, a tampered hmac, a foreign shop or a missing code are each refused", () => {
  const good = { code: "c1", shop: domain, state: "s1", timestamp: "1" };
  const refuse = (query, why) => {
    const r = verifyCallback({ query, state: "s1", clientSecret: secret, domain });
    assert.equal(r.ok, false, why);
    return r.problem;
  };
  assert.match(refuse(signed({ ...good, state: "other" }), "state"), /state/);
  const tampered = signed(good);
  tampered.set("code", "evil");
  assert.match(refuse(tampered, "hmac"), /hmac/i);
  assert.match(refuse(signed({ ...good, shop: "evil.myshopify.com" }), "shop"), /shop/);
  const noCode = signed({ shop: domain, state: "s1", timestamp: "1" });
  assert.match(refuse(noCode, "code"), /code/);
});

test("the shop pattern is anchored so a lookalike domain cannot pass", () => {
  assert.ok(SHOP_PATTERN.test("my-shop.myshopify.com"));
  assert.ok(!SHOP_PATTERN.test("my-shop.myshopify.com.evil.com"));
  assert.ok(!SHOP_PATTERN.test("evil.com/my-shop.myshopify.com"));
});

/** Plays the part of the browser: waits for the server to be ready, then calls back. */
function run({ callback, exchange, timeoutMs = 5000 }) {
  const saved = [];
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const promise = runOAuth({
    domain,
    clientId: "id",
    clientSecret: secret,
    scopes: ["write_products"],
    port: 0,
    timeoutMs,
    fetchFn: exchange,
    save: (key, value) => saved.push([key, value]),
    onReady: resolveReady,
  });
  const browser = ready.then(async ({ redirect, authorizeUrl }) => {
    const state = new URL(authorizeUrl).searchParams.get("state");
    const fields = [...callback(state)];
    if (!fields.length) return; // nobody clicks Install
    const target = new URL(redirect.replace("localhost", "127.0.0.1"));
    for (const [k, v] of fields) target.searchParams.set(k, v);
    await fetch(target);
  });
  return { promise, browser, saved };
}

const okExchange = async () => new Response(JSON.stringify({ access_token: "shpat_oauth", scope: "write_products" }), { status: 200 });

test("a good callback exchanges the code and saves the token", async () => {
  const { promise, browser, saved } = run({
    exchange: okExchange,
    callback: (state) => signed({ code: "c1", shop: domain, state, timestamp: "1" }).entries(),
  });
  const result = await promise;
  await browser;
  assert.deepEqual(result, { token: "shpat_oauth", scope: "write_products", expiresIn: null });
  assert.deepEqual(saved, [["SHOPIFY_ADMIN_TOKEN", "shpat_oauth"]]);
});

test("a forged callback is refused and nothing is exchanged or saved", async () => {
  let exchanged = false;
  const { promise, browser, saved } = run({
    exchange: async () => {
      exchanged = true;
      return okExchange();
    },
    callback: (state) => new URLSearchParams({ code: "c1", shop: domain, state, timestamp: "1", hmac: "0".repeat(64) }).entries(),
  });
  await assert.rejects(promise, /hmac/i);
  await browser;
  assert.equal(exchanged, false);
  assert.deepEqual(saved, []);
});

test("Shopify refusing the exchange is reported with its status", async () => {
  const { promise, browser } = run({
    exchange: async () => new Response("bad code", { status: 400 }),
    callback: (state) => signed({ code: "c1", shop: domain, state, timestamp: "1" }).entries(),
  });
  await assert.rejects(promise, /HTTP 400/);
  await browser;
});

test("an expiring token is reported so the caller can warn", async () => {
  const { promise, browser } = run({
    exchange: async () => new Response(JSON.stringify({ access_token: "shpat_x", scope: "s", expires_in: 3600 }), { status: 200 }),
    callback: (state) => signed({ code: "c1", shop: domain, state, timestamp: "1" }).entries(),
  });
  assert.equal((await promise).expiresIn, 3600);
  await browser;
});

test("nobody clicking Install ends in a timeout, not a hang", async () => {
  const { promise } = run({ exchange: okExchange, callback: () => [], timeoutMs: 50 });
  await assert.rejects(promise, /timed out/);
});

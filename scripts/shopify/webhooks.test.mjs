import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { planWebhooks, webhookSecretStatus, registerWebhooks, TOPICS, WEBHOOK_PATH } from "./webhooks.mjs";

const node = (id, topic, callbackUrl) => ({ id, topic, endpoint: { callbackUrl } });
const site = "https://shop.example.gr";
const target = `${site}${WEBHOOK_PATH}`;

test("the target is the SDK's revalidate route", () => {
  assert.equal(WEBHOOK_PATH, "/api/revalidate");
  assert.equal(planWebhooks([], `${site}/`).callbackUrl, target);
});

test("with nothing registered every topic is created", () => {
  const plan = planWebhooks([], site);
  assert.deepEqual(plan.create, TOPICS);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.remove, []);
});

test("topics already pointing at the target are kept, the rest created", () => {
  const plan = planWebhooks([node("1", "PRODUCTS_CREATE", target)], site);
  assert.deepEqual(plan.keep, ["PRODUCTS_CREATE"]);
  assert.ok(!plan.create.includes("PRODUCTS_CREATE"));
  assert.equal(plan.create.length, TOPICS.length - 1);
});

test("a subscription for this route at an old URL is removed, so a stale staging site stops being called", () => {
  const plan = planWebhooks([node("9", "PRODUCTS_UPDATE", `https://old.example.gr${WEBHOOK_PATH}`)], site);
  assert.deepEqual(plan.remove, [{ id: "9", topic: "PRODUCTS_UPDATE", url: `https://old.example.gr${WEBHOOK_PATH}` }]);
  assert.ok(plan.create.includes("PRODUCTS_UPDATE"));
});

test("webhooks for other routes are left alone", () => {
  const plan = planWebhooks([node("5", "ORDERS_PAID", "https://invoices.example.com/hook")], site);
  assert.deepEqual(plan.remove, []);
});

test("the secret must be the app client secret, and each failure says what to do", () => {
  assert.equal(webhookSecretStatus({ clientSecret: "a", webhookSecret: "a" }).ok, true);
  assert.match(webhookSecretStatus({ clientSecret: "a", webhookSecret: "b" }).note, /differs/);
  assert.match(webhookSecretStatus({ clientSecret: "a", webhookSecret: "" }).note, /refuses every request/);
  assert.equal(webhookSecretStatus({ clientSecret: "", webhookSecret: "a" }).ok, false);
});

function fakeShopify(existing) {
  const calls = [];
  const reply = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  const handler = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (/webhookSubscriptions\(/.test(query)) return reply({ webhookSubscriptions: { nodes: existing } });
    if (/webhookSubscriptionCreate/.test(query)) return reply({ webhookSubscriptionCreate: { webhookSubscription: { id: "gid://new" }, userErrors: [] } });
    if (/webhookSubscriptionDelete/.test(query)) return reply({ webhookSubscriptionDelete: { userErrors: [] } });
    throw new Error("unexpected query");
  };
  return { handler, calls };
}
const count = (calls, pattern) => calls.filter((c) => pattern.test(c.query)).length;

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "hook-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_hooktest";
});
afterEach(() => {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  mock.restoreAll();
});

test("registering creates the missing topics with the JSON format and the target URL", async () => {
  const shop = fakeShopify([node("1", "PRODUCTS_CREATE", target)]);
  mock.method(globalThis, "fetch", shop.handler);
  await registerWebhooks({ siteUrl: site });
  const creates = shop.calls.filter((c) => /webhookSubscriptionCreate/.test(c.query));
  assert.equal(creates.length, TOPICS.length - 1);
  assert.deepEqual(creates[0].variables.subscription, { callbackUrl: target, format: "JSON" });
  assert.ok(creates.every((c) => c.variables.topic !== "PRODUCTS_CREATE"));
});

test("registering twice changes nothing the second time", async () => {
  const all = TOPICS.map((t, i) => node(String(i), t, target));
  const shop = fakeShopify(all);
  mock.method(globalThis, "fetch", shop.handler);
  await registerWebhooks({ siteUrl: site });
  assert.equal(count(shop.calls, /webhookSubscriptionCreate/), 0);
  assert.equal(count(shop.calls, /webhookSubscriptionDelete/), 0);
});

test("a dry run reads but writes nothing", async () => {
  const shop = fakeShopify([]);
  mock.method(globalThis, "fetch", shop.handler);
  const plan = await registerWebhooks({ siteUrl: site, dryRun: true });
  assert.equal(plan.create.length, TOPICS.length);
  assert.equal(count(shop.calls, /webhookSubscriptionCreate/), 0);
});

test("stale subscriptions are deleted before new ones are created", async () => {
  const shop = fakeShopify([node("9", "PRODUCTS_UPDATE", `https://old.example.gr${WEBHOOK_PATH}`)]);
  mock.method(globalThis, "fetch", shop.handler);
  await registerWebhooks({ siteUrl: site });
  const order = shop.calls.map((c) => (/Delete/.test(c.query) ? "delete" : /Create/.test(c.query) ? "create" : "list"));
  assert.ok(order.indexOf("delete") < order.indexOf("create"));
});

test("a non-https or missing URL is refused before any call", async () => {
  const shop = fakeShopify([]);
  mock.method(globalThis, "fetch", shop.handler);
  await assert.rejects(registerWebhooks({ siteUrl: "http://localhost:3000" }), /public https/);
  await assert.rejects(registerWebhooks({ siteUrl: "" }), /public https/);
  assert.equal(shop.calls.length, 0);
});

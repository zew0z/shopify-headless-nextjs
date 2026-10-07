import test from "node:test";
import assert from "node:assert/strict";
import { loadSdkDocuments, classifyResponse, badVariables, validateDocuments } from "./validate-storefront.mjs";

test("loads every real SDK query and mutation, fragments inlined, nothing left to interpolate", () => {
  const docs = loadSdkDocuments();
  const names = docs.map((d) => d.name);
  assert.ok(names.includes("getProductsQuery"));
  assert.ok(names.includes("createCartMutation"));
  assert.equal(docs.length, 19);
  for (const d of docs) {
    assert.match(d.query.trim(), /^(query|mutation)\b/, d.name);
    assert.ok(!d.query.includes("${"), `${d.name} still has an unresolved interpolation`);
  }
  assert.match(docs.find((d) => d.name === "getProductsQuery").query, /fragment ProductFragment on Product/);
});

test("a schema error is a problem, with Shopify's message", () => {
  const r = classifyResponse({ errors: [{ message: "Field 'nope' doesn't exist on type 'Product'", extensions: { code: "undefinedField" } }] });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /nope/);
});

test("a variable-coercion error means the document itself passed validation", () => {
  const r = classifyResponse({ errors: [{ message: "Variable $h of type String! was provided invalid value" }] });
  assert.deepEqual(r, { ok: true, problems: [] });
});

test("an expired or unknown API version is reported, not treated as valid", () => {
  const r = classifyResponse({ error: "Invalid API version" });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /Invalid API version/);
});

test("data coming back is fine", () => {
  assert.deepEqual(classifyResponse({ data: { shop: { name: "x" } } }), { ok: true, problems: [] });
});

test("badVariables makes every declared variable uncoercible, including ones with defaults", () => {
  const q = "query GetProducts($first: Int = 20, $after: String, $sortKey: ProductSortKeys = RELEVANCE) { shop { name } }";
  assert.deepEqual(badVariables(q), { first: { __invalid: true }, after: { __invalid: true }, sortKey: { __invalid: true } });
  assert.deepEqual(badVariables("query { shop { name } }"), {});
});

test("validateDocuments posts each document to the requested version with bad variables", async () => {
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { json: async () => ({ errors: [{ message: "Variable $a of type ID! was provided invalid value" }] }) };
  };
  const results = await validateDocuments({ version: "2026-07", documents: [{ name: "x", query: "mutation M($a: ID!) { shop { name } }" }], fetchFn });
  assert.deepEqual(results, [{ name: "x", ok: true, problems: [] }]);
  assert.equal(sent[0].url, "https://shopify.dev/storefront-graphql-direct-proxy/2026-07");
  assert.deepEqual(sent[0].body.variables, { a: { __invalid: true } });
});

test("a mutation with no variables is refused rather than executed", async () => {
  let called = false;
  const fetchFn = async () => {
    called = true;
    return { json: async () => ({}) };
  };
  const [r] = await validateDocuments({ version: "2026-07", documents: [{ name: "m", query: "mutation { cartCreate { cart { id } } }" }], fetchFn });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /would execute/);
  assert.equal(called, false);
});

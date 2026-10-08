import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";
const {loadAnalyticsScript: loadExternalProofScript, AnalyticsScriptLoadError: ProofScriptLoadError} = await loadSdk("analytics-script-loader");

const src = "https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js";
function harness() {
  const nodes = [];
  const events = new EventTarget();
  const activeTimers = new Map();
  let sequence = 0;
  const document = {
    createElement() {return {remove() {nodes.splice(nodes.indexOf(this), 1);}};},
    head: {appendChild(node) {nodes.push(node);}},
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const options = {
    schedule(callback) {const id = ++sequence; activeTimers.set(id, callback); return id;},
    cancel(id) {activeTimers.delete(id);},
  };
  return {nodes, events, activeTimers, document, options};
}

test("resource failure remains a generic observed failure and removes the failed element for recovery", async () => {
  const h = harness();
  const first = loadExternalProofScript(h.document, src, "shopify-consent", h.options);
  const failure = assert.rejects(first, (error) => {
    assert.ok(error instanceof ProofScriptLoadError);
    assert.equal(error.kind, "resource-error");
    assert.equal(error.resource, src);
    assert.match(error.message, /browser did not expose the cause/);
    assert.ok(!error.message.includes("adblock"));
    return true;
  });
  h.nodes[0].onerror();
  await failure;
  assert.equal(h.nodes.length, 0);
  assert.equal(h.activeTimers.size, 0);
  const retry = loadExternalProofScript(h.document, src, "shopify-consent", h.options);
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].src, src);
  assert.equal(h.nodes[0].crossOrigin, "anonymous");
  assert.equal(h.nodes[0].referrerPolicy, "no-referrer");
  h.nodes[0].onload();
  await retry;
  assert.equal(h.activeTimers.size, 0);
});

test("timeout detaches all callbacks, so a late load cannot mark the failed attempt ready", async () => {
  const h = harness();
  const result = loadExternalProofScript(h.document, src, "shopify-consent", h.options);
  const node = h.nodes[0];
  const failure = assert.rejects(result, (error) => error.kind === "timeout");
  [...h.activeTimers.values()][0]();
  await failure;
  assert.equal(node.onload, null);
  assert.equal(node.onerror, null);
  assert.equal(h.nodes.length, 0);
  assert.equal(h.activeTimers.size, 0);
});

test("a matching enforced CSP violation is identified precisely", async () => {
  const h = harness();
  const result = loadExternalProofScript(h.document, src, "shopify-consent", h.options);
  const failure = assert.rejects(result, (error) => error.kind === "csp" && error.message.includes("script-src-elem"));
  const event = new Event("securitypolicyviolation");
  Object.assign(event, {blockedURI: "https://cdn.shopify.com", effectiveDirective: "script-src-elem", disposition: "enforce"});
  h.events.dispatchEvent(event);
  await failure;
  assert.equal(h.nodes.length, 0);
});

test("unrelated or report-only policy violations do not reject a successful load", async () => {
  const h = harness();
  const result = loadExternalProofScript(h.document, src, "shopify-consent", h.options);
  for (const details of [
    {blockedURI: src, effectiveDirective: "script-src", disposition: "report"},
    {blockedURI: "https://unrelated.example", effectiveDirective: "script-src", disposition: "enforce"},
    {blockedURI: src, effectiveDirective: "img-src", disposition: "enforce"},
  ]) {
    const event = new Event("securitypolicyviolation");
    Object.assign(event, details);
    h.events.dispatchEvent(event);
  }
  assert.equal(h.nodes.length, 1);
  h.nodes[0].onload();
  await result;
  assert.equal(h.activeTimers.size, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { getShopifyScriptTags } from "@shopify/hydrogen";
import { loadSdk } from "../test-support/load-sdk.mjs";
const { createAnalyticsTracker } = await loadSdk("analytics-tracker");
const origin = "https://shop.example.com";
const paths = ["/", "/products", "/contact", "/products/%CE%B1"];
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(r => setImmediate(r));
function fixture(over = {}) {
  const sent = [], writes = [];
  let choice = over.saved ?? "";
  const privacy = { consentStatus: "loaded", currentVisitorConsent: () => ({analytics:choice}), analyticsProcessingAllowed: () => choice === "yes",
    async setTrackingConsent(value) { writes.push(value); if (over.write) await over.write(value); choice = value.analytics ? "yes" : "no"; } };
  const options = {origin,paths,loadPrivacy:async on => {on();return privacy;},initialize:async()=>{},loadSender:async()=>{},publish:p=>sent.push(p.url),...over};
  const controller = createAnalyticsTracker(options);
  return {controller,privacy,sent,writes,deny:()=>{choice="no";}};
}
test("pending/rejected navigation is never published or replayed; accept sends only the current page", async () => {
  const f=fixture();f.controller.visit("/");await f.controller.boot();f.controller.visit("/products");
  assert.equal(f.sent.length,0);await f.controller.choose(false);f.controller.visit("/contact");assert.equal(f.sent.length,0);
  await f.controller.choose(true);assert.deepEqual(f.sent,[`${origin}/contact`]);
  assert.deepEqual(f.writes[1],{analytics:true,marketing:false,preferences:false,sale_of_data:false});
});
test("saved acceptance restores without writing consent; rejection stays off and settings can reopen", async()=>{
  const a=fixture({saved:"yes"});a.controller.visit("/");await a.controller.boot();assert.deepEqual(a.sent,[`${origin}/`]);assert.equal(a.writes.length,0);
  const b=fixture({saved:"no"});b.controller.visit("/");await b.controller.boot();assert.equal(b.sent.length,0);assert.equal(b.controller.getSnapshot().open,false);b.controller.open();assert.equal(b.controller.getSnapshot().open,true);
});
test("queries/Strict Mode repeats deduplicate, back navigation counts, Unicode paths survive", async()=>{
  const f=fixture({saved:"yes"});await f.controller.boot();
  for(const path of ["/?email=private","/#private","/products","/","/products/α?private"])f.controller.visit(path);
  assert.deepEqual(f.sent,[`${origin}/`,`${origin}/products`,`${origin}/`,`${origin}/products/%CE%B1`]);
  for(const path of ["/account/private","https://other.example/","/products/unknown"])f.controller.visit(path);
  assert.equal(f.sent.length,4);
});
test("acceptance racing navigation waits for the sender and emits only the final page", async()=>{
  const sender=deferred();const f=fixture({loadSender:()=>sender.promise});await f.controller.boot();f.controller.visit("/");
  const accept=f.controller.choose(true);await tick();f.controller.visit("/products");f.controller.visit("/contact");assert.equal(f.sent.length,0);sender.resolve();await accept;assert.deepEqual(f.sent,[`${origin}/contact`]);
});
test("withdrawal stops synchronously, including during an inflight acceptance, and the last durable write rejects",async()=>{
  const write=deferred();const f=fixture({write:v=>v.analytics?write.promise:Promise.resolve()});await f.controller.boot();f.controller.visit("/");
  const accept=f.controller.choose(true);await tick();const reject=f.controller.choose(false);f.controller.visit("/contact");assert.equal(f.controller.canTrack(),false);
  write.resolve();await Promise.all([accept,reject]);assert.equal(f.sent.length,0);assert.equal(f.privacy.currentVisitorConsent().analytics,"no");assert.equal(f.controller.getSnapshot().choice,"rejected");
});
test("failed withdrawal stays stopped, and external withdrawal disables an active sender",async()=>{
  const f=fixture({saved:"yes",write:async()=>{throw Error("offline");}});f.controller.visit("/");await f.controller.boot();
  const reject=f.controller.choose(false);assert.equal(f.controller.canTrack(),false);f.controller.visit("/contact");await reject;assert.equal(f.sent.length,1);assert.equal(f.controller.getSnapshot().failed,true);
  const g=fixture({saved:"yes"});await g.controller.boot();g.deny();g.controller.syncPrivacy();g.controller.visit("/");assert.equal(g.sent.length,0);
});
test("blocked consent, blocked sender, and thrown publication fail closed without stopping navigation",async()=>{
  for(const over of [{loadPrivacy:async()=>{throw Error();}},{saved:"yes",loadSender:async()=>{throw Error();}},{saved:"yes",publish:()=>{throw Error();}}]) {
    const f=fixture(over);f.controller.visit("/");await f.controller.boot();f.controller.visit("/contact");assert.equal(f.sent.length,0);assert.equal(f.controller.canTrack(),false);assert.equal(f.controller.getSnapshot().failed,true);
  }
});
test("boot is singleton and disable prevents saved acceptance from activating after a race",async()=>{
  const sender=deferred();let calls=0;const f=fixture({saved:"yes",loadSender:()=>{calls++;return sender.promise;}});
  const a=f.controller.boot(),b=f.controller.boot();assert.equal(a,b);await tick();f.controller.disable();sender.resolve();await a;assert.equal(calls,1);f.controller.visit("/");await f.controller.choose(true);assert.equal(f.sent.length,0);
});
test("the real pinned Headless bus receives no rejected history or duplicate replay after reacceptance",async()=>{
  const f=fixture();const document=new EventTarget();const window={location:{href:origin},Shopify:{customerPrivacy:f.privacy}};
  const tags=getShopifyScriptTags({shop:{shopId:"1",storefrontId:"0",myshopifyDomain:"fixture.myshopify.com"},analytics:{channel:"headless"},consent:{mode:"custom-banner",setup:async()=>{}},shopifyAnalytics:false});
  vm.runInNewContext(tags.scripts.find(s=>s.attributes?.id==="shopify-analytics-bus").innerHTML,{window,document,console});
  const received=[];const bus=window.Shopify.analytics;
  assert.deepEqual(JSON.parse(JSON.stringify(bus.getConfig().shop)),{shopId:"gid://shopify/Shop/1",channel:"headless"});
  bus.addDestination({name:"mock",setup({subscribe}){subscribe("page_viewed",p=>received.push(p.url));}});
  const t=createAnalyticsTracker({origin,paths,loadPrivacy:async on=>{on();return f.privacy;},initialize:async()=>{bus[Symbol.for("shopify.hydrogen.custom-consent")](async()=>{});await tick();},loadSender:async()=>{},publish:p=>bus.publish("page_viewed",p)});
  t.visit("/");await t.boot();t.visit("/products");await t.choose(true);assert.deepEqual(received,[`${origin}/products`]);
  await t.choose(false);document.dispatchEvent(new Event("visitorConsentCollected"));t.visit("/contact");await t.choose(true);document.dispatchEvent(new Event("visitorConsentCollected"));assert.deepEqual(received,[`${origin}/products`,`${origin}/contact`]);
});

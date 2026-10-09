import test from "node:test";
import assert from "node:assert/strict";
import {analyticsConfiguration,checkAnalytics} from "./analytics-setup.mjs";
import {makeFixture} from "../test-support/fixture.mjs";
import {loadSdk} from "../test-support/load-sdk.mjs";
const {ANALYTICS_PACKAGE_VERSION}=await loadSdk("analytics-policy");
// A wired repo of its own, so the check does not depend on this repo's layout (root-layout repos have no src/app).
const LAYOUT="export default function L({ children }) { return <html><body><ShopifyAnalytics />{children}</body></html>; }";
const wired=(root="src/",layout=LAYOUT)=>makeFixture({
  "package.json":{dependencies:{"@shopify/hydrogen":ANALYTICS_PACKAGE_VERSION}},
  [`${root}lib/shopify/index.ts`]:"export {};",
  [`${root}app/layout.tsx`]:layout,
  [`${root}app/api/shopify/analytics/config/route.ts`]:"export {};",
  [`${root}app/api/[version]/graphql.json/route.ts`]:"export {};",
});
const env={SHOPIFY_ANALYTICS_ENABLED:"1",NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN:"fixture.myshopify.com",SHOPIFY_ANALYTICS_SHOP_ID:"1",SHOPIFY_ANALYTICS_ORIGINS:"https://shop.example.com",SHOPIFY_ANALYTICS_COUNTRY:"US",SHOPIFY_ANALYTICS_LANGUAGE:"EN",SHOPIFY_ANALYTICS_CURRENCY:"USD"};
test("configure changes only explicit public settings, validates before writing and can disable safely",()=>{
  assert.deepEqual(analyticsConfiguration({disable:true},{}),{changes:{SHOPIFY_ANALYTICS_ENABLED:"0"},issues:[]});
  assert.ok(analyticsConfiguration({enable:true},{}).issues.length);
  assert.deepEqual(analyticsConfiguration({enable:true,paths:"/,/contact"},env),{changes:{SHOPIFY_ANALYTICS_ENABLED:"1",SHOPIFY_ANALYTICS_PUBLIC_PATHS:"/,/contact"},issues:[]});
  assert.ok(analyticsConfiguration({origins:true},env).issues.length);
});
test("analytics-check is read-only, fails invalid config and never sends an analytics event",async()=>{
  assert.ok((await checkAnalytics({dir:wired(),env:{}})).some(c=>!c.ok));
  const calls=[];const results=await checkAnalytics({dir:wired(),env,site:env.SHOPIFY_ANALYTICS_ORIGINS,fetchImpl:async(url,init)=>{
    calls.push({url,init});return Response.json({shop:{shopId:"1",myshopifyDomain:"fixture.myshopify.com"}},{headers:{"cache-control":"private, no-store"}});
  }});
  assert.ok(results.every(c=>c.ok),JSON.stringify(results));assert.equal(calls.length,1);assert.match(calls[0].url,/\/api\/shopify\/analytics\/config$/);assert.deepEqual(JSON.parse(calls[0].init.body),{path:"/"});
});
test("analytics-check finds the wiring in a repo without src/, and names a layout that does not mount ShopifyAnalytics",async()=>{
  const mounted=c=>c.what==="Root layout mounts ShopifyAnalytics";
  const root=await checkAnalytics({dir:wired(""),env});
  assert.ok(root.every(c=>c.ok),JSON.stringify(root));
  const bare=await checkAnalytics({dir:wired("","export default function L({ children }) { return children; }"),env});
  assert.equal(bare.find(mounted).ok,false);assert.ok(bare.filter(c=>!mounted(c)).every(c=>c.ok),JSON.stringify(bare));
});

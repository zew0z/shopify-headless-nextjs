import test from "node:test";
import assert from "node:assert/strict";
import {analyticsConfiguration,checkAnalytics} from "./analytics-setup.mjs";
const env={SHOPIFY_ANALYTICS_ENABLED:"1",NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN:"fixture.myshopify.com",SHOPIFY_ANALYTICS_SHOP_ID:"1",SHOPIFY_ANALYTICS_ORIGINS:"https://shop.example.com",SHOPIFY_ANALYTICS_COUNTRY:"US",SHOPIFY_ANALYTICS_LANGUAGE:"EN",SHOPIFY_ANALYTICS_CURRENCY:"USD"};
test("configure changes only explicit public settings, validates before writing and can disable safely",()=>{
  assert.deepEqual(analyticsConfiguration({disable:true},{}),{changes:{SHOPIFY_ANALYTICS_ENABLED:"0"},issues:[]});
  assert.ok(analyticsConfiguration({enable:true},{}).issues.length);
  assert.deepEqual(analyticsConfiguration({enable:true,paths:"/,/contact"},env),{changes:{SHOPIFY_ANALYTICS_ENABLED:"1",SHOPIFY_ANALYTICS_PUBLIC_PATHS:"/,/contact"},issues:[]});
  assert.ok(analyticsConfiguration({origins:true},env).issues.length);
});
test("analytics-check is read-only, fails invalid config and never sends an analytics event",async()=>{
  assert.ok((await checkAnalytics({env:{}})).some(c=>!c.ok));
  const calls=[];const results=await checkAnalytics({env,site:env.SHOPIFY_ANALYTICS_ORIGINS,fetchImpl:async(url,init)=>{
    calls.push({url,init});return Response.json({shop:{shopId:"1",myshopifyDomain:"fixture.myshopify.com"}},{headers:{"cache-control":"private, no-store"}});
  }});
  assert.ok(results.every(c=>c.ok),JSON.stringify(results));assert.equal(calls.length,1);assert.match(calls[0].url,/\/api\/shopify\/analytics\/config$/);assert.deepEqual(JSON.parse(calls[0].init.body),{path:"/"});
});

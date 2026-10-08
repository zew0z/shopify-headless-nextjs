import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";
const {readAnalyticsConfig,analyticsRequestOrigin,analyticsPaths}=await loadSdk("analytics-config");
const {sanitizeAnalyticsBatch,analyticsConsentQuery}=await loadSdk("analytics-policy");
const {proxyAnalyticsConsent}=await loadSdk("analytics-consent-proxy");
const env={SHOPIFY_ANALYTICS_ENABLED:"1",NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN:"fixture.myshopify.com",SHOPIFY_ANALYTICS_SHOP_ID:"gid://shopify/Shop/1",SHOPIFY_ANALYTICS_ORIGINS:"https://shop.example.com",SHOPIFY_ANALYTICS_COUNTRY:"US",SHOPIFY_ANALYTICS_LANGUAGE:"EN",SHOPIFY_ANALYTICS_CURRENCY:"USD",SHOPIFY_ANALYTICS_PUBLIC_PATHS:"/,/contact"};
const config=readAnalyticsConfig(env).config,origin=config.origins[0];
const query='query { consentManagement { cookies(visitorConsent:{analytics:true,marketing:true,preferences:true,saleOfData:true},origReferrer:"https://private.example?email=private",landingPage:"/?phone=private") { trackingConsentCookie cookieDomain landingPageCookie origReferrerCookie shopifyUnique shopifyVisit } customerAccountUrl } }';
const request=(headers={},body={query},url=`${origin}/api/unstable/graphql.json`)=>new Request(url,{method:"POST",headers:{origin,"content-type":"application/json",...headers},body:JSON.stringify(body)});
test("configuration is explicit, generic, credential-free and rejects missing or malformed store/origin/localization",()=>{
  assert.equal(config.shop.shopId,"1");assert.equal(readAnalyticsConfig({}).config,null);
  for(const changes of [{SHOPIFY_ANALYTICS_ENABLED:"0"},{SHOPIFY_ANALYTICS_SHOP_ID:"0"},{NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN:"evil.example/path"},{SHOPIFY_ANALYTICS_ORIGINS:"https://shop.example.com/"},{SHOPIFY_ANALYTICS_ORIGINS:"http://shop.example.com"},{SHOPIFY_ANALYTICS_COUNTRY:"unknown"},{SHOPIFY_ANALYTICS_PUBLIC_PATHS:"/account?email=private"}])assert.equal(readAnalyticsConfig({...env,...changes}).config,null);
  assert.ok(!JSON.stringify(readAnalyticsConfig({...env,SHOPIFY_ADMIN_TOKEN:"private",SHOPIFY_STOREFRONT_PRIVATE_TOKEN:"private"}).config).includes("private"));
});
test("loopback requires an explicit flag; cross-site and unconfigured hosts fail through a reverse proxy",()=>{
  assert.equal(analyticsRequestOrigin(request({},undefined,"http://localhost:3000/api/unstable/graphql.json"),config),null);
  assert.equal(analyticsRequestOrigin(request({host:"shop.example.com"},undefined,"http://localhost:3000/api/unstable/graphql.json"),config),origin);
  for(const h of [{origin:"https://other.example.com"},{host:"other.example.com"},{"sec-fetch-site":"cross-site"}])assert.equal(analyticsRequestOrigin(request(h),config),null);
  const local={...env,SHOPIFY_ANALYTICS_ORIGINS:"http://localhost:3000"};assert.equal(readAnalyticsConfig(local).config,null);assert.ok(readAnalyticsConfig({...local,SHOPIFY_ANALYTICS_LOCAL:"1"}).config);
});
test("only actual public Shopify product handles are added, including Unicode",async()=>{
  const looked=[];const lookup=async h=>{looked.push(h);return h==="α"?{id:"public"}:null;};
  assert.ok((await analyticsPaths("/products/α",config,lookup)).includes("/products/%CE%B1"));
  for(const p of ["/products/unknown","/products/private%2Fsecret","/account/private","https://other.example/products/α","/products/α?email=private"]){const paths=await analyticsPaths(p,config,lookup);assert.deepEqual(paths,config.publicPaths);}
  assert.deepEqual(looked,["α","unknown"]);
});
test("consent operation is bounded and strips URL data and all non-statistics purposes",()=>{
  const clean=analyticsConsentQuery({query});assert.ok(clean);assert.ok(!clean.includes("private"));assert.match(clean,/marketing:false,preferences:false,saleOfData:false/);
  for(const body of [{query:"mutation { cartCreate { id } }"},{query,variables:{secret:"private"}},{query:query.replace("analytics:true","analytics:true,analytics:false")},{query:query.replace("customerAccountUrl","customerAccountUrl email")}])assert.equal(analyticsConsentQuery(body),null);
});
test("official sender payload strips identity, URL data, unknown fields and unapproved events",()=>{
  const p={event_name:"page_rendered",source:"headless",api_client_id:12875497473,shop_id:1,hydrogenSubchannelId:"0",analytics_allowed:true,marketing_allowed:true,sale_of_data_allowed:true,customer_id:123,event_source_url:`${origin}/contact?email=private#phone`,canonical_url:`${origin}/?private`,referrer:"https://private.example",email:"private",form:{phone:"private"}};
  const batch=p=>JSON.stringify({events:[{schema_id:"custom_storefront_customer_tracking/1.2",payload:p,metadata:{event_created_at_ms:1,private:"private"}}],metadata:{event_sent_at_ms:2,private:"private"}});
  const clean=sanitizeAnalyticsBatch(batch(p),origin,config,config.publicPaths);assert.ok(clean&&!clean.includes("private"));const out=JSON.parse(clean).events[0].payload;assert.equal(out.event_source_url,`${origin}/contact`);assert.equal(out.customer_id,0);assert.equal(out.referrer,"");assert.equal(out.marketing_allowed,false);
  for(const over of [{shop_id:2},{source:"hydrogen"},{analytics_allowed:false},{event_name:"product_added_to_cart"},{event_source_url:`${origin}/account/private`}])assert.equal(sanitizeAnalyticsBatch(batch({...p,...over}),origin,config,config.publicPaths),null);
  const extension={...p,event_name:"product_added_to_cart",cart_token:"public?key=private",products:[JSON.stringify({name:"Public product",quantity:1,email:"private"})]};
  const enabled=sanitizeAnalyticsBatch(batch(extension),origin,{...config,experimentalEvents:true},config.publicPaths);assert.ok(enabled&&!enabled.includes("private"));assert.equal(JSON.parse(enabled).events[0].payload.cart_token,"public");
});
test("consent responses are fresh per request; only Shopify cookies and no credentials reach upstream",async()=>{
  const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return Response.json({data:{consentManagement:{cookies:{shopifyVisit:`visit-${calls.length}`,trackingConsentCookie:"consent"},customerAccountUrl:"private"}}},{headers:{"set-cookie":"_shopify_s=safe; Path=/"}});};
  for(let i=1;i<=2;i++){
    const res=await proxyAnalyticsConsent(request({cookie:"app_session=private; _shopify_y=public",authorization:"Bearer private","x-shopify-storefront-access-token":"private"}),config,fetchImpl);
    assert.equal(res.status,200);assert.match(res.headers.get("cache-control"),/private, no-store/);assert.match(res.headers.get("cdn-cache-control"),/no-store/);assert.equal((await res.json()).data.consentManagement.cookies.shopifyVisit,`visit-${i}`);
  }
  assert.equal(calls.length,2);for(const {url,init} of calls){assert.equal(url,"https://fixture.myshopify.com/api/unstable/graphql.json");assert.equal(init.cache,"no-store");assert.equal(init.redirect,"manual");assert.ok(!JSON.stringify({headers:[...init.headers],body:init.body}).includes("private"));}
});
test("disabled, invalid origin, oversized, unbounded operations and upstream failure fail closed",async()=>{
  let calls=0;const fail=async()=>{calls++;throw Error("private");};
  assert.equal((await proxyAnalyticsConsent(request(),null,fail)).status,403);
  assert.equal((await proxyAnalyticsConsent(request({origin:"https://evil.example"}),config,fail)).status,403);
  assert.equal((await proxyAnalyticsConsent(request({}, {query:"x".repeat(9000)}),config,fail)).status,413);
  assert.equal((await proxyAnalyticsConsent(request({}, {query:"query { shop { id } }"}),config,fail)).status,400);assert.equal(calls,0);
  const res=await proxyAnalyticsConsent(request(),config,fail);assert.equal(res.status,502);assert.ok(!(await res.text()).includes("private"));
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getShopifyScriptTags } from "@shopify/hydrogen";
import { findSdkDir } from "../scripts/shopify/sdk-dir.mjs";

// Isolated synthetic origin. All Shopify resources/transport are intercepted; no live events.
const origin = "https://kit.test";
const sdk = findSdkDir(process.cwd());
const official = path.resolve("node_modules/@shopify/hydrogen/dist");
const config = {shop:{shopId:"1",storefrontId:"0",myshopifyDomain:"fixture.myshopify.com"},i18n:{country:"US",language:"EN",currency:"USD"},origins:[origin],publicPaths:["/","/contact","/products","/products/%CE%B1"],productPathPrefix:"/products",experimentalEvents:false};
const tags = getShopifyScriptTags({shop:config.shop,i18n:config.i18n,analytics:{channel:"headless"},consent:{mode:"custom-banner",setup:async()=>{}},shopifyAnalytics:false});
const html = `<!doctype html><title>Kit rehearsal</title><script type="importmap">{"imports":{"@shopify/hydrogen":"/shopify.mjs"}}</script>
<a href="/products" id="products">Products</a><a href="/contact" id="contact">Contact</a><button id="add">Add to cart</button><output id="cart">0</output>
<button id="accept">Accept</button><button id="reject">Reject / withdraw</button><button id="settings">Cookie settings</button><output id="state"></output>
<script type="module">
import {analyticsStore} from '/sdk/analytics-browser';
window.rehearsal=analyticsStore;
const visit=()=>analyticsStore.visit();
document.querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();history.pushState({},'',a.href);void visit();});
add.onclick=()=>cart.value=Number(cart.value)+1;
accept.onclick=()=>analyticsStore.choose(true);reject.onclick=()=>analyticsStore.choose(false);settings.onclick=()=>analyticsStore.open();
analyticsStore.subscribe(()=>state.value=JSON.stringify(analyticsStore.getSnapshot()));
window.addEventListener('popstate',visit);void visit();
</script>`;

const consentScript = `{
let choice=localStorage.getItem('fixture-consent')||'';
window.Shopify.customerPrivacy={consentStatus:'loaded',currentVisitorConsent:()=>({analytics:choice}),analyticsProcessingAllowed:()=>choice==='yes',
setTrackingConsent:async c=>{await fetch('/api/unstable/graphql.json',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query { consentManagement { cookies(visitorConsent:{analytics:'+c.analytics+',marketing:false,preferences:false,saleOfData:false},origReferrer:"private",landingPage:"/?email=private") { trackingConsentCookie cookieDomain landingPageCookie origReferrerCookie shopifyUnique shopifyVisit } customerAccountUrl } }'})});choice=c.analytics?'yes':'no';localStorage.setItem('fixture-consent',choice);document.dispatchEvent(new Event('visitorConsentCollected'));}}
document.dispatchEvent(new Event('consentTrackingApiLoaded'));
}`;
const senderScript = `window.fixtureBusEvents=[];window.Shopify.analytics.addDestination({name:'mock-shopify-transport',setup({subscribe}){
subscribe('page_viewed',p=>void fetch('https://monorail-edge.shopifysvc.com/unstable/produce_batch',{method:'POST',body:JSON.stringify({events:[{schema_id:'custom_storefront_customer_tracking/1.2',payload:{event_name:'page_rendered',source:'headless',api_client_id:12875497473,shop_id:1,hydrogenSubchannelId:'0',analytics_allowed:true,event_source_url:location.href,referrer:'https://private.example',customer_id:123,email:'private'}}]})}));
for(const [name,eventName] of [['product_viewed','product_page_rendered'],['product_added_to_cart','product_added_to_cart']])subscribe(name,p=>{
window.fixtureBusEvents.push({name,payload:p});
const products=name==='product_viewed'?p.products.map(x=>({name:x.title,quantity:x.quantity})): [{name:p.currentLine.merchandise.product.title,quantity:p.currentLine.quantity-(p.prevLine?.quantity||0)}];
void fetch('https://monorail-edge.shopifysvc.com/unstable/produce_batch',{method:'POST',body:JSON.stringify({events:[{schema_id:'custom_storefront_customer_tracking/1.2',payload:{event_name:eventName,source:'headless',api_client_id:12875497473,shop_id:1,hydrogenSubchannelId:'0',analytics_allowed:true,event_source_url:location.href,products:products.map(x=>JSON.stringify(x)),cart_token:p.cart?.id}}]})});
});
}});`;

async function rehearsal(page, {blocked, experimental=false}={}) {
  const events=[],requests=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());requests.push(url.href);
    if(url.origin===origin){
      if(url.pathname==='/api/shopify/analytics/config')return route.fulfill({json:{...config,experimentalEvents:experimental},headers:{'cache-control':'private, no-store'}});
      if(url.pathname==='/api/unstable/graphql.json')return route.fulfill({json:{data:{consentManagement:{cookies:{shopifyVisit:'fixture'}}}},headers:{'cache-control':'private, no-store'}});
      if(url.pathname==='/shopify.mjs')return route.fulfill({contentType:'text/javascript',body:`export const AnalyticsEvent={PAGE_VIEWED:'page_viewed',PRODUCT_VIEWED:'product_viewed'};export function getShopifyScriptTags(){return ${JSON.stringify(tags)}};export {initializeShopifyScripts} from '/official/core/shopify-scripts/initialize.mjs';export {trackCartAnalytics} from '/official/core/analytics/cart-tracker.mjs';`});
      if(url.pathname.startsWith('/sdk/')){
        const name=path.basename(url.pathname);
        if(!/^analytics-[a-z-]+$/.test(name))return route.abort();
        const source=readFileSync(path.join(sdk,`${name}.ts`),'utf8');
        return route.fulfill({contentType:'text/javascript',body:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText});
      }
      if(url.pathname.startsWith('/official/')){
        const file=path.resolve(official,url.pathname.slice(10));
        if(!file.startsWith(`${official}/`)||!file.endsWith('.mjs'))return route.abort();
        return route.fulfill({contentType:'text/javascript',body:readFileSync(file,'utf8')});
      }
      return route.fulfill({contentType:'text/html',body:html});
    }
    if(url.hostname==='cdn.shopify.com'){
      if(url.pathname.includes('consent-tracking-api'))return blocked==='consent'?route.abort('blockedbyclient'):route.fulfill({contentType:'text/javascript',body:consentScript});
      if(url.pathname==='/storefront/analytics/shopify.js')return blocked==='sender'?route.abort('blockedbyclient'):route.fulfill({contentType:'text/javascript',body:senderScript});
      return route.fulfill({contentType:'text/javascript',body:'export class PageViewEvent extends Event {constructor(){super("fixture-page-view");}}'});
    }
    if(url.hostname==='monorail-edge.shopifysvc.com'){
      events.push(JSON.parse(route.request().postData()));return route.fulfill({status:200,body:'{}',headers:{'access-control-allow-origin':'*'}});
    }
    return route.abort();
  });
  await page.goto(origin);
  return {events,requests};
}
const state=page=>page.evaluate(()=>window.rehearsal.getSnapshot());

test('pending/reject zero events, current-page acceptance, navigation/back dedupe, saved choices and withdrawal',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {events}=await rehearsal(page);
  await expect.poll(async()=>(await state(page)).ready).toBe(true);
  await page.click('#products');await page.click('#reject');await page.click('#contact');expect(events).toHaveLength(0);
  await page.click('#accept');await expect.poll(()=>events.length).toBe(1);
  expect(events[0].events[0].payload.event_source_url).toBe(`${origin}/contact`);expect(JSON.stringify(events)).not.toContain('private');
  await page.click('#products');await expect.poll(()=>events.length).toBe(2);
  await page.evaluate(()=>window.rehearsal.visit());expect(events).toHaveLength(2);
  await page.goBack();await expect.poll(()=>events.length).toBe(3);
  await page.reload();await expect.poll(()=>events.length).toBe(4);expect((await state(page)).choice).toBe('accepted');
  await page.click('#reject');await page.click('#products');await expect.poll(async()=>(await state(page)).choice).toBe('rejected');expect(events).toHaveLength(4);
  await page.reload();await expect.poll(async()=>(await state(page)).ready).toBe(true);expect((await state(page)).choice).toBe('rejected');expect(events).toHaveLength(4);
  await page.click('#add');await expect(page.locator('#cart')).toHaveText('1');expect(errors).toEqual([]);
});
for(const blocked of ['consent','sender'])test(`blocked ${blocked} keeps tracking off and shopping usable`,async({page})=>{
  const {events}=await rehearsal(page,{blocked});
  if(blocked==='sender'){await expect.poll(async()=>(await state(page)).ready).toBe(true);await page.click('#accept');}
  await expect.poll(async()=>(await state(page)).failed).toBe(true);
  await page.click('#products');await page.click('#add');await expect(page.locator('#cart')).toHaveText('1');expect(events).toHaveLength(0);
});

test('existing product/cart hooks share the official bus, require opt-in, and deduplicate successful added quantities',async({page})=>{
  const {events}=await rehearsal(page,{experimental:true});await expect.poll(async()=>(await state(page)).ready).toBe(true);await page.click('#accept');await expect.poll(()=>events.length).toBe(1);
  await page.evaluate(()=>{
    window.rehearsal.productView('/',[{productGid:'gid://shopify/Product/11',variantGid:'gid://shopify/ProductVariant/22',name:'Mug',variantName:'Blue',brand:'Fixture',price:'12.50',quantity:1}]);
    const cart={id:'gid://shopify/Cart/cart-1?key=private',updatedAt:'2026-10-08T00:00:00Z',cost:{totalAmount:{amount:'37.50',currencyCode:'USD'},subtotalAmount:{amount:'37.50',currencyCode:'USD'}},lines:{edges:[{node:{id:'line-1',quantity:3,cost:{totalAmount:{amount:'37.50',currencyCode:'USD'}},merchandise:{id:'gid://shopify/ProductVariant/22',title:'Blue',price:{amount:'12.50',currencyCode:'USD'},product:{id:'gid://shopify/Product/11',title:'Mug',vendor:'Fixture'}}}}]}};
    window.rehearsal.addToCart(cart,[{merchandiseId:'gid://shopify/ProductVariant/22',quantity:2}]);window.rehearsal.addToCart(cart,[{merchandiseId:'gid://shopify/ProductVariant/22',quantity:2}]);
  });
  await expect.poll(()=>events.length).toBe(3);const bus=await page.evaluate(()=>window.fixtureBusEvents);expect(bus.map(e=>e.name)).toEqual(['product_viewed','product_added_to_cart']);
  const added=bus[1].payload;expect(added.currentLine.quantity-added.prevLine.quantity).toBe(2);expect(added.cart.id).toBe('gid://shopify/Cart/cart-1');expect(JSON.stringify(events)).not.toContain('private');
  await page.click('#reject');await page.evaluate(()=>window.rehearsal.productView('/',[{productGid:'gid://shopify/Product/11',variantGid:'gid://shopify/ProductVariant/23',name:'Mug',variantName:'Red',brand:'Fixture',price:'12.50'}]));expect(events).toHaveLength(3);
});
test('page-views-only configuration keeps preserved optional hooks inactive',async({page})=>{
  const {events}=await rehearsal(page);await expect.poll(async()=>(await state(page)).ready).toBe(true);await page.click('#accept');await expect.poll(()=>events.length).toBe(1);
  await page.evaluate(()=>window.rehearsal.productView('/',[{productGid:'gid://shopify/Product/11',variantGid:'gid://shopify/ProductVariant/22',name:'Mug',brand:'Fixture',price:'12.50'}]));expect(events).toHaveLength(1);
});

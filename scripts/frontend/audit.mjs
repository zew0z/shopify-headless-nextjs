import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { detectStack } from "./stack.mjs";
import {
  findDataReaders,
  findFakeApis,
  findImporters,
  findInventedFields,
  findPaymentForms,
  findProductData,
  findSiteData,
  TEST_FILE,
} from "./sources.mjs";
import { listSourceFiles } from "./walk.mjs";

const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");
const eachLine = (dir, files, fn) => {
  for (const file of files) read(dir, file).split("\n").forEach((text, i) => fn(file, i + 1, text));
};

const CHECKOUT_WORD = /\bcheckout\b|Ολοκλήρωση|Ταμείο/i;
const ARIA_CHECKOUT = /aria-label=["']([^"']*(?:checkout|Ολοκλήρωση|Ταμείο)[^"']*)["']/i;

/** Visible JSX text on a line: text between tags, or a line that is only text (multi-line JSX). */
function jsxTexts(line) {
  let text = line;
  for (let prev; prev !== text; ) {
    prev = text;
    text = text.replace(/\{[^{}]*\}/g, "");
  }
  const between = [...text.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  if (between.length) return between;
  const alone = text.trim();
  return alone && !/[<>=();:{}]/.test(alone) ? [alone] : [];
}

/** Where the received frontend keeps its cart, and its checkout buttons. */
export function findCart(dir, files) {
  const cartFiles = [];
  const checkoutButtons = [];
  eachLine(dir, files, (file, line, text) => {
    const aboutCart = !/^\s*import\b/.test(text) && (/cart/i.test(text) || /cart/i.test(path.basename(file)));
    if (aboutCart && /\bcreateContext\b/.test(text)) cartFiles.push({ file, line, why: "cart context" });
    else if (aboutCart && /\bcreate\s*[(<]/.test(text)) cartFiles.push({ file, line, why: "cart store" });
    const stored = /localStorage\.(get|set|remove)Item\(/.test(text) && /cart/i.test(text);
    if (stored && !cartFiles.some((c) => c.file === file && c.why === "cart kept in localStorage")) {
      cartFiles.push({ file, line, why: "cart kept in localStorage" });
    }
    if (!/\.[jt]sx?$/.test(file)) return;
    const aria = ARIA_CHECKOUT.exec(text);
    if (aria) checkoutButtons.push({ file, line, text: aria[1] });
    for (const label of jsxTexts(text)) {
      // A button label is a few words; a sentence that mentions checkout is not a button.
      if (CHECKOUT_WORD.test(label) && label.split(/\s+/).length <= 5) checkoutButtons.push({ file, line, text: label });
    }
  });
  return { files: cartFiles, checkoutButtons };
}

const CACHING_OFF = [
  [/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/, () => 'dynamic = "force-dynamic"'],
  [/export\s+const\s+fetchCache\s*=\s*["']((?:force|default|only)-no-store)["']/, (m) => `fetchCache = "${m[1]}"`],
  [/export\s+const\s+revalidate\s*=\s*0(?![\d.])/, () => "revalidate = 0"],
  [/\bcache\s*:\s*["']no-store["']/, () => 'cache: "no-store"'],
  [/\b(unstable_noStore|noStore)\(\)/, (m) => `${m[1]}()`],
  [/\bawait\s+connection\(\)/, () => "connection()"],
];

/** Everything that makes Next.js fetch on every request, so cached Shopify reads would never be used. */
export function findCachingOff(dir, files) {
  const found = [];
  eachLine(dir, files, (file, line, text) => {
    for (const [pattern, what] of CACHING_OFF) {
      const m = pattern.exec(text);
      if (m) found.push({ file, line, what: what(m) });
    }
  });
  return found;
}

const SYMBOL = "[€£¥₹]";
const HARDCODED_MONEY = [
  new RegExp(`${SYMBOL}\\s*\\$?\\{`), // €{price}, `€${price}`
  new RegExp(`\\}\\s*${SYMBOL}`), // {price} €
  /\$\$\{/, // `$${price}`
  />\s*\$\{[^}]*(price|amount|total|cost)/i, // <span>${price}</span>
  new RegExp(`["'\`]\\s*(${SYMBOL}|\\$)\\s*["'\`]`), // "€" + price
  new RegExp(`${SYMBOL}\\s*\\d[\\d.,]*|\\d[\\d.,]*\\s*${SYMBOL}`), // over €50, €1,299.00
  /\((€|£|\$|EUR|USD|GBP)\)/, // "Price (€)": a currency label with no number
  /\bcurrency\s*:\s*["'`][A-Z]{3}["'`]/, // currency: "EUR"
];
// "Only $5". Not on lines calling .replace, where "$1" is a capture group.
const DOLLAR_AMOUNT = /(^|[\s>"'`(])\$\d/;
const REPLACE_CALL = /\.replace(All)?\(/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

/** Prices shown with a currency the frontend chose instead of the one Shopify returned. */
export function findHardcodedMoney(dir, files) {
  const found = [];
  eachLine(dir, files, (file, line, text) => {
    if (COMMENT.test(text)) return;
    const patterns = REPLACE_CALL.test(text) ? HARDCODED_MONEY : [...HARDCODED_MONEY, DOLLAR_AMOUNT];
    const m = patterns.map((p) => p.exec(text)).find(Boolean);
    if (m) found.push({ file, line, what: m[0].trim().replace(/[.,]+$/, "").slice(0, 40) });
  });
  return found;
}

/** Shopify serves product images from cdn.shopify.com; next/image refuses hosts it was not told about. */
export function checkImages(dir) {
  const config = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"].find((f) => existsSync(path.join(dir, f)));
  if (!config) return { ok: false, note: "No next.config file, so next/image will refuse Shopify's images. Add one allowing cdn.shopify.com." };
  const text = read(dir, config);
  if (text.includes("cdn.shopify.com")) return { ok: true, note: `${config} allows cdn.shopify.com.` };
  if (/unoptimized\s*:\s*true/.test(text)) return { ok: true, note: `${config} turns image optimisation off, so Shopify images load as they are.` };
  return { ok: false, note: `${config} does not allow cdn.shopify.com: add it to images.remotePatterns.` };
}

/** The kit's API routes, once installed, import the SDK; the frontend's own routes do not. */
export function isKitRoute(dir, file) {
  return /^(src\/)?app\/api\/(cart|revalidate|health|search)\/route\.ts$/.test(file) && read(dir, file).includes("lib/shopify");
}

/** Everything the agent needs to know about a received frontend before installing the kit. */
export function auditFrontend(dir) {
  const stack = detectStack(dir);
  const files = (existsSync(dir) ? listSourceFiles(dir) : []).filter((file) => !isKitRoute(dir, file));
  const productData = findProductData(dir, files);
  const siteData = findSiteData(dir, files, productData);
  // Data files nothing imports are never shown to a customer, so what they hold is not a live problem.
  const importers = findImporters(dir, files);
  const dataFiles = new Set([...productData.map((d) => d.file), ...siteData.map((d) => d.file), ...files.filter((f) => /(^|\/)data\//.test(f))]);
  const unused = [...dataFiles].filter((f) => !importers.get(f).length).sort();
  // Old product data files are already reported as hardcoded products; tests never reach a customer.
  const priceFiles = files.filter((f) => !productData.some((d) => d.file === f) && !unused.includes(f) && !TEST_FILE.test(f));
  return {
    stack,
    productData,
    dataReaders: findDataReaders(dir, files, productData),
    fakeApis: findFakeApis(dir, files, productData),
    siteData,
    inventedFields: findInventedFields(dir, files),
    paymentForms: findPaymentForms(dir, files),
    unused,
    cart: findCart(dir, files),
    cachingOff: findCachingOff(dir, files),
    hardcodedMoney: findHardcodedMoney(dir, priceFiles),
    images: checkImages(dir),
  };
}

const places = (n) => `${n} place${n === 1 ? "" : "s"}`;

/** The audit in plain words, most important line first. */
export function summariseAudit(audit) {
  const { stack, productData, dataReaders, fakeApis, siteData, inventedFields, paymentForms, unused, cart, cachingOff, hardcodedMoney, images } = audit;
  const lines = [stack.supported ? `Kit fits: ${stack.reason}` : `Stop: ${stack.reason}`];
  if (paymentForms.length) {
    lines.push(`Most urgent: ${places(paymentForms.length)} with a card payment form. Card details must never be typed into this site; Shopify's checkout takes the payment, so remove it:`);
    for (const f of paymentForms) lines.push(`  ${f.file}:${f.line} ${f.what}`);
  }
  const total = productData.reduce((sum, d) => sum + d.count, 0);
  if (productData.length) {
    lines.push(`${total} hardcoded products in ${places(productData.length)}:`);
    for (const d of productData) {
      lines.push(`  ${d.file}:${d.line} (${d.count})`);
      const readers = dataReaders.filter((r) => r.target === d.file).map((r) => `${r.file}:${r.line}`);
      lines.push(readers.length ? `    read by ${readers.join(", ")}` : "    read by nothing");
    }
  } else lines.push("No hardcoded product lists found.");
  if (fakeApis.length) {
    lines.push(`${fakeApis.length} fake product API call${fakeApis.length === 1 ? "" : "s"} or route${fakeApis.length === 1 ? "" : "s"}:`);
    for (const a of fakeApis) lines.push(`  ${a.file}:${a.line} ${a.kind === "route" ? `serves ${a.target}` : a.target}`);
  } else lines.push("No fake product APIs found.");
  if (cart.files.length || cart.checkoutButtons.length) {
    lines.push(`Cart state in ${places(cart.files.length)}, ${cart.checkoutButtons.length} checkout button${cart.checkoutButtons.length === 1 ? "" : "s"}:`);
    for (const c of cart.files) lines.push(`  ${c.file}:${c.line} ${c.why}`);
    for (const b of cart.checkoutButtons) lines.push(`  ${b.file}:${b.line} "${b.text}"`);
  } else lines.push("No cart found. This flow expects the frontend to have one: ask the owner.");
  if (cachingOff.length) {
    lines.push(`Caching is switched off in ${places(cachingOff.length)} (pages showing products must not do this):`);
    for (const c of cachingOff) lines.push(`  ${c.file}:${c.line} ${c.what}`);
  } else lines.push("Nothing switches caching off.");
  if (hardcodedMoney.length) {
    lines.push(`Prices with a hardcoded currency in ${places(hardcodedMoney.length)} (use formatMoney with Shopify's currency):`);
    for (const m of hardcodedMoney) lines.push(`  ${m.file}:${m.line} ${m.what}`);
  } else lines.push("No hardcoded currency symbols found.");
  if (siteData.length) {
    lines.push(`Menus, policies, pages or store claims typed into the code in ${places(siteData.length)} (read them from Shopify, hide what Shopify cannot supply):`);
    for (const d of siteData) lines.push(`  ${d.file}:${d.line} ${d.what}`);
  }
  if (inventedFields.length) {
    lines.push(`Fields Shopify does not give by default (ratings, stock counts, badges...) in ${places(inventedFields.length)}: show them only if Shopify supplies them:`);
    for (const f of inventedFields) lines.push(`  ${f.file}:${f.line} ${f.what}`);
  }
  if (unused.length) {
    lines.push(`${unused.length} unused hardcoded data file${unused.length === 1 ? "" : "s"} (nothing imports ${unused.length === 1 ? "it" : "them"}), ask the owner before deleting:`);
    for (const f of unused) lines.push(`  ${f}`);
  }
  lines.push(`Images: ${images.note}`);
  return lines;
}

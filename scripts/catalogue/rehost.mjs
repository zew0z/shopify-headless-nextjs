/**
 * Photos from hosts that block Shopify's image fetcher: download them here and
 * upload them to Shopify Files, then hand Shopify its own CDN url. The url map
 * is saved after every upload in data/image-map.json (commit it), so a re-run
 * uploads only what is new. Which hosts block Shopify is a fact about a supplier:
 * pass them with --rehost=<host>; nothing is assumed.
 * UNVERIFIED until run against a development store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adminGraphQL } from "../shopify/admin-client.mjs";

export const IMAGE_MAP_FILE = path.join(process.cwd(), "data", "image-map.json");
const IMG_SRC = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;

function onHost(url, hosts) {
  try {
    const host = new URL(url).hostname;
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function rehostTargets(catalog, hosts) {
  if (!hosts.length) return [];
  const urls = [
    ...(catalog.collections ?? []).map((c) => c.image).filter(Boolean),
    ...(catalog.products ?? []).flatMap((p) => [...(p.images ?? []), ...[...(p.descriptionHtml ?? "").matchAll(IMG_SRC)].map((m) => m[1])]),
  ];
  return [...new Set(urls.filter((u) => onHost(u, hosts)))];
}

export function applyImageMap(catalog, map) {
  const swap = (url) => map[url] ?? url;
  const swapHtml = (html) => (html ? Object.entries(map).reduce((out, [from, to]) => out.split(from).join(to), html) : html);
  return {
    ...catalog,
    collections: (catalog.collections ?? []).map((c) => (c.image ? { ...c, image: swap(c.image) } : c)),
    products: (catalog.products ?? []).map((p) => ({ ...p, ...(p.images && { images: p.images.map(swap) }), ...(p.descriptionHtml && { descriptionHtml: swapHtml(p.descriptionHtml) }) })),
  };
}

const STAGED = `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`;
const FILE_CREATE = `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id fileStatus } userErrors { field message } } }`;
const FILE_POLL = `query($id: ID!) { node(id: $id) { ... on MediaImage { id fileStatus image { url } } } }`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Download, staged upload, file create, then wait: Shopify processes files asynchronously. */
export async function uploadImage(url, { waitMs = 800, tries = 40 } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
  const filename = path.basename(new URL(url).pathname) || "image";

  const staged = await adminGraphQL(STAGED, { input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.length) }] });
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) throw new Error(`staged upload HTTP ${up.status}`);

  const created = await adminGraphQL(FILE_CREATE, { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: filename }] });
  const id = created.fileCreate.files[0].id;
  for (let i = 0; i < tries; i++) {
    const node = (await adminGraphQL(FILE_POLL, { id })).node;
    if (node?.fileStatus === "READY" && node.image?.url) return node.image.url;
    if (node?.fileStatus === "FAILED") throw new Error("Shopify could not process the file");
    await sleep(waitMs);
  }
  throw new Error("timed out waiting for Shopify to process the file");
}

export async function rehostImages(urls, { mapFile = IMAGE_MAP_FILE, upload = uploadImage, log = console.log } = {}) {
  const map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, "utf8")) : {};
  const pending = urls.filter((u) => !map[u]);
  log(`  photos to re-upload: ${urls.length}, already done ${urls.length - pending.length}, now ${pending.length}`);
  const failed = [];
  for (const url of pending) {
    try {
      map[url] = await upload(url);
      mkdirSync(path.dirname(mapFile), { recursive: true });
      writeFileSync(mapFile, `${JSON.stringify(map, null, 2)}\n`);
    } catch (error) {
      failed.push({ url, error: error.message });
    }
  }
  return { map, failed };
}

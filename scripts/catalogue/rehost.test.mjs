import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeFixture } from "../test-support/fixture.mjs";
import { rehostTargets, applyImageMap, rehostImages, uploadImage } from "./rehost.mjs";

const catalog = {
  collections: [{ handle: "sofas", title: "Sofas", image: "https://www.blocked.gr/c.jpg" }],
  products: [
    { handle: "a", title: "A", images: ["https://blocked.gr/1.jpg", "https://fine.com/2.jpg"], descriptionHtml: '<p>x</p><img src="https://cdn.blocked.gr/body.png">', variants: [] },
    { handle: "b", title: "B", images: ["https://blocked.gr/1.jpg"], variants: [] },
  ],
};

test("targets are every photo on a listed host or its subdomains, once", () => {
  assert.deepEqual(rehostTargets(catalog, ["blocked.gr"]), ["https://www.blocked.gr/c.jpg", "https://blocked.gr/1.jpg", "https://cdn.blocked.gr/body.png"]);
  assert.deepEqual(rehostTargets(catalog, []), []);
});

test("the map replaces urls in images, collection images and descriptions, and leaves the input alone", () => {
  const map = { "https://blocked.gr/1.jpg": "https://cdn.shopify.com/1.jpg", "https://cdn.blocked.gr/body.png": "https://cdn.shopify.com/body.png" };
  const out = applyImageMap(catalog, map);
  assert.deepEqual(out.products[0].images, ["https://cdn.shopify.com/1.jpg", "https://fine.com/2.jpg"]);
  assert.match(out.products[0].descriptionHtml, /cdn\.shopify\.com\/body\.png/);
  assert.equal(out.collections[0].image, "https://www.blocked.gr/c.jpg");
  assert.equal(catalog.products[0].images[0], "https://blocked.gr/1.jpg");
});

test("uploads skip what the map has, save after each one, and list failures without stopping", async () => {
  const root = makeFixture({ "data/image-map.json": { "https://x/done.jpg": "https://cdn.shopify.com/done.jpg" } });
  const mapFile = path.join(root, "data/image-map.json");
  const uploaded = [];
  const upload = async (url) => {
    if (url.endsWith("bad.jpg")) throw new Error("HTTP 404");
    uploaded.push(url);
    return url.replace("https://x/", "https://cdn.shopify.com/");
  };
  const { map, failed } = await rehostImages(["https://x/done.jpg", "https://x/new.jpg", "https://x/bad.jpg"], { mapFile, upload, log: () => {} });
  assert.deepEqual(uploaded, ["https://x/new.jpg"]);
  assert.equal(map["https://x/new.jpg"], "https://cdn.shopify.com/new.jpg");
  assert.deepEqual(failed, [{ url: "https://x/bad.jpg", error: "HTTP 404" }]);
  assert.equal(JSON.parse(readFileSync(mapFile, "utf8"))["https://x/new.jpg"], "https://cdn.shopify.com/new.jpg");
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
});

test("one upload: download, staged target, form post, file create, wait until ready", async () => {
  process.env.SHOPIFY_STORE_DOMAIN = "rehost-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_rehosttest";
  const steps = [];
  let polls = 0;
  const gql = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    if (u === "https://blocked.gr/sofa.webp") {
      steps.push("download");
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
    }
    if (u === "https://upload.example/target") {
      steps.push(`post ${init.method}`);
      return new Response("", { status: 201 });
    }
    const { query, variables } = JSON.parse(init.body);
    if (/stagedUploadsCreate/.test(query)) {
      steps.push(`staged ${variables.input[0].mimeType} ${variables.input[0].fileSize}`);
      return gql({ stagedUploadsCreate: { stagedTargets: [{ url: "https://upload.example/target", resourceUrl: "https://upload.example/resource", parameters: [{ name: "key", value: "k" }] }], userErrors: [] } });
    }
    if (/fileCreate/.test(query)) {
      steps.push(`create ${variables.files[0].originalSource}`);
      return gql({ fileCreate: { files: [{ id: "gid://file/1", fileStatus: "UPLOADED" }], userErrors: [] } });
    }
    if (/node\(id/.test(query)) {
      polls += 1;
      return gql({ node: polls < 2 ? { id: "gid://file/1", fileStatus: "PROCESSING", image: null } : { id: "gid://file/1", fileStatus: "READY", image: { url: "https://cdn.shopify.com/s/files/sofa.webp" } } });
    }
    throw new Error(`unexpected ${u}`);
  });
  assert.equal(await uploadImage("https://blocked.gr/sofa.webp", { waitMs: 0 }), "https://cdn.shopify.com/s/files/sofa.webp");
  assert.deepEqual(steps, ["download", "staged image/webp 3", "post POST", "create https://upload.example/resource"]);
});

test("a photo Shopify cannot process is an error, not a silent gap", async () => {
  process.env.SHOPIFY_STORE_DOMAIN = "rehost-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_rehosttest";
  const gql = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url).startsWith("https://blocked.gr")) return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg" } });
    if (String(url) === "https://upload.example/target") return new Response("", { status: 201 });
    const { query } = JSON.parse(init.body);
    if (/stagedUploadsCreate/.test(query)) return gql({ stagedUploadsCreate: { stagedTargets: [{ url: "https://upload.example/target", resourceUrl: "r", parameters: [] }], userErrors: [] } });
    if (/fileCreate/.test(query)) return gql({ fileCreate: { files: [{ id: "gid://file/2", fileStatus: "UPLOADED" }], userErrors: [] } });
    return gql({ node: { id: "gid://file/2", fileStatus: "FAILED", image: null } });
  });
  await assert.rejects(uploadImage("https://blocked.gr/x.jpg", { waitMs: 0 }), /Shopify could not process/);
});

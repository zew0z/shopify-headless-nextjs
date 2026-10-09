# Port the old kit's proven pieces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the pieces that worked on the live xristos-store (old kit) into this kit, as generic, tested kit code: Shopify content definitions, content entries, photo re-upload, reviews and hero slides read from Shopify, a contact and newsletter form, link-preview metadata, and the NOTIXV deploy files.

**Architecture:** Setup-side work lives in `scripts/catalogue/` (Admin API, run from a laptop) and is wired into `pnpm shop-setup`. Storefront-side work lives in the SDK directory `src/lib/shopify/` and `src/app/api/`, which `kit-install` copies into a received frontend. Pure functions are unit-tested with `node --test`; every network call is tested against a fake `fetch`. Nothing about a particular shop (names, addresses, keys, hosts) is typed into the kit.

**Tech Stack:** Node 24 ESM scripts, Next.js 16.3 App Router, TypeScript, Shopify Admin GraphQL and Storefront GraphQL (2026-07), Resend HTTP API, Docker + GitHub Actions (NOTIXV Google Cloud).

**Spec:** The audit in the "Kit template 0-to-100 gaps" session (2026-10-08), section "What I found", items 1 and 7, plus the user's answers on 2026-10-09: deploy = NOTIXV setup for every shop; newsletter = email to the owner. Old code for reference: a read-only clone of `NOTIXV/xristos-store` in the session scratchpad (`scripts/push/push-definitions.mjs`, `push-swatches.mjs`, `push-files.mjs`, `lib/hero.mjs`, `lib/email.ts`, `app/api/contact/route.ts`, `Dockerfile`, `.github/workflows/deploy-image.yaml`).

## Global Constraints

- xristos-store is LIVE. Read the local clone only. Never push to it, open PRs on it, or run anything against its Shopify store or env.
- Nothing hardcoded: no product, price, claim, shop name, address, email address, API key or supplier host typed into kit code. Values come from Shopify, env vars, the catalogue source module, or CLI flags.
- No new npm dependencies.
- Tests: `node --test`, run with `pnpm test:scripts`. Write the failing test first and see it fail.
- Every Admin write is idempotent (keyed on handle, type or namespace.key). A second run changes nothing.
- Shopify field names that cannot be checked offline are marked `UNVERIFIED until run against a development store` in a code comment, like `scripts/catalogue/push.mjs` already does.
- User-facing CLI output and docs: plain English, short sentences.
- The user's shell is fish: wrap multi-line shell in `bash -c '...'`.
- Commit each task to `main` with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Facts checked on 2026-10-09

- `metaobjectDefinitionCreate` needs `write_metaobject_definitions`; `metaobjectUpsert` needs `write_metaobjects` (shopify.dev Admin reference).
- `metafieldDefinitionCreate` needs access to the namespace and the owner resource; for PRODUCT that is `write_products`, which the kit already asks for. (Shopify's page names no scope; unverified on a dev store.)
- Storefront `metaobjects(type:)` for a type that does not exist returns `{ nodes: [] }`, not an error (mock.shop, 2026-10-09).
- Whether the Storefront API hides DRAFT entries of a publishable type is NOT stated in Shopify's docs. The kit enables the publishable capability and upserts entries as ACTIVE; mark draft behaviour unverified.
- Storefront `customerCreate` requires a password, so it cannot be a newsletter sign-up. Hence email to the owner.

## File map

| File | Responsibility |
|---|---|
| `scripts/catalogue/definitions.mjs` (new) | Kit content types, definitions wanted by a catalogue, validation, plan against what the store has, push |
| `scripts/catalogue/metaobjects.mjs` (new) | Validate and upsert content entries (swatches, materials...), return their ids |
| `scripts/catalogue/rehost.mjs` (new) | Download photos from hosts that block Shopify and upload them to Shopify Files; the url map |
| `scripts/catalogue/format.mjs` | Metafield `refs` rules |
| `scripts/catalogue/build.mjs` | Carry `definitions` and `metaobjects` through merge and read |
| `scripts/catalogue/build-input.mjs` | Resolve `refs` to ids |
| `scripts/catalogue/push.mjs` | Order: definitions, entries, collections, products; apply the image map |
| `scripts/shopify/admin-client.mjs` | `SCOPES.content` |
| `scripts/setup/cli.mjs` | `definitions` command, `--rehost` flag |
| `src/lib/shopify/metaobjects.ts` (new, browser-safe, pure) | Map raw entries to `Review`, `HeroSlide`; `reviewSummary` |
| `src/lib/shopify/content.ts` | `getMetaobjects`, `getReviews`, `getHeroSlides` |
| `src/lib/shopify/queries.ts`, `types.ts` | `metaobjectsQuery`, entry types |
| `src/lib/shopify/contact.ts` (new, server-only) | Parse contact and newsletter forms, send through Resend |
| `src/app/api/contact/route.ts` (new) | The form endpoint |
| `src/lib/shopify/seo.ts` (new) | `productMetadata`, `collectionMetadata`, `shareImageUrl` |
| `scripts/frontend/templates.mjs`, `kit.mjs` | Dockerfile and deploy workflow added when missing; `contact` route shipped |
| `scripts/setup/steps.mjs`, `docs/*.md`, `.claude/skills/*/SKILL.md` | Tell the agent and owner about all of the above |

---

### Task 1: Content definitions (types and fields the storefront can read)

The kit pushes product metafields but never creates their definitions, so the Storefront API returns `null` for every one (see `docs/shopify-api-gotchas.md`, "Storefront API returns null for every metafield"). This task creates them, plus the kit's own content types.

**Files:**
- Create: `scripts/catalogue/definitions.mjs`, `scripts/catalogue/definitions.test.mjs`
- Modify: `scripts/catalogue/build.mjs` (`mergeSources`, `readCatalogFile`), `scripts/catalogue/build.test.mjs`
- Modify: `scripts/shopify/admin-client.mjs` (`SCOPES`)
- Modify: `scripts/setup/cli.mjs` (new `definitions` case, `USAGE`)

**Interfaces:**
- Produces (`definitions.mjs`):
  - `kitDefinitions({ wantsReviews }): { metaobjects: MetaobjectDef[], metafields: MetafieldDef[] }`
  - `wantedDefinitions(catalog, { wantsReviews }): { metaobjects, metafields, problems: string[] }`
  - `planDefinitions(wanted, existing): { createTypes, addFields, createFields, openAccess, problems }`
  - `pushDefinitions(wanted, { log = console.log }): Promise<{ typeIds: Record<string,string> }>`
  - `MetaobjectDef = { type, name, displayNameKey, fieldDefinitions: [{ key, name, type, required?, validations? }] }`
  - `MetafieldDef = { ownerType: "PRODUCT", namespace, key, name, type, refType? }`
- Produces (`build.mjs`): the catalogue object gains `definitions: { metaobjects: [], metafields: [] }` and `metaobjects: []` (entries, used in Task 2).

- [ ] **Step 1: Write the failing tests**

`scripts/catalogue/definitions.test.mjs`:

```js
import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { kitDefinitions, wantedDefinitions, planDefinitions, pushDefinitions } from "./definitions.mjs";

const product = (metafields) => ({ handle: "a", title: "A", variants: [{ sku: "1", price: "1" }], metafields });

test("the kit always defines hero slides, and reviews only when the owner wants them", () => {
  assert.deepEqual(kitDefinitions({ wantsReviews: false }).metaobjects.map((d) => d.type), ["hero_slide"]);
  assert.deepEqual(kitDefinitions({ wantsReviews: true }).metaobjects.map((d) => d.type), ["hero_slide", "customer_review"]);
});

test("a review's rating is required and limited to 1-5", () => {
  const review = kitDefinitions({ wantsReviews: true }).metaobjects.find((d) => d.type === "customer_review");
  const rating = review.fieldDefinitions.find((f) => f.key === "rating");
  assert.equal(rating.required, true);
  assert.deepEqual(rating.validations, [{ name: "min", value: "1" }, { name: "max", value: "5" }]);
});

test("every metafield the catalogue sets gets a definition, once", () => {
  const catalog = {
    products: [
      product([{ namespace: "custom", key: "seats", type: "number_integer", value: "3" }]),
      product([{ namespace: "custom", key: "seats", type: "number_integer", value: "2" }]),
    ],
  };
  const { metafields, problems } = wantedDefinitions(catalog, {});
  assert.deepEqual(problems, []);
  assert.deepEqual(metafields, [{ ownerType: "PRODUCT", namespace: "custom", key: "seats", name: "Seats", type: "number_integer" }]);
});

test("one key with two types is a problem, not a guess", () => {
  const catalog = {
    products: [
      product([{ namespace: "custom", key: "seats", type: "number_integer", value: "3" }]),
      product([{ namespace: "custom", key: "seats", type: "single_line_text_field", value: "3" }]),
    ],
  };
  assert.match(wantedDefinitions(catalog, {}).problems[0], /custom\.seats.*number_integer.*single_line_text_field/);
});

test("a reference metafield takes its target type from its refs", () => {
  const catalog = {
    definitions: { metaobjects: [{ type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field", required: true }] }] },
    products: [product([{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }])],
  };
  const { metafields, metaobjects, problems } = wantedDefinitions(catalog, {});
  assert.deepEqual(problems, []);
  assert.equal(metafields[0].refType, "color_swatch");
  assert.deepEqual(metaobjects.map((d) => d.type), ["hero_slide", "color_swatch"]);
});

test("refs to a type nobody defined are a problem", () => {
  const catalog = { products: [product([{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }])] };
  assert.match(wantedDefinitions(catalog, {}).problems.join("\n"), /custom\.color refers to type "color_swatch", which no definition declares/);
});

test("a source cannot redefine a kit type", () => {
  const catalog = { definitions: { metaobjects: [{ type: "hero_slide", name: "X", displayNameKey: "title", fieldDefinitions: [{ key: "title", name: "T", type: "single_line_text_field" }] }] }, products: [] };
  assert.match(wantedDefinitions(catalog, {}).problems[0], /hero_slide is a kit type/);
});

test("the plan creates what is missing, adds missing fields, opens storefront access, and refuses type changes", () => {
  const wanted = {
    metaobjects: [
      { type: "hero_slide", name: "Hero slide", displayNameKey: "title", fieldDefinitions: [{ key: "title", name: "Title", type: "single_line_text_field" }, { key: "rank", name: "Order", type: "number_integer" }] },
      { type: "material", name: "Material", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field" }] },
    ],
    metafields: [
      { ownerType: "PRODUCT", namespace: "custom", key: "seats", name: "Seats", type: "number_integer" },
      { ownerType: "PRODUCT", namespace: "custom", key: "frame", name: "Frame", type: "single_line_text_field" },
      { ownerType: "PRODUCT", namespace: "custom", key: "space", name: "Space", type: "single_line_text_field" },
    ],
  };
  const existing = {
    metaobjects: [{ id: "gid://mo/1", type: "hero_slide", fieldDefinitions: [{ key: "title", type: { name: "single_line_text_field" } }] }],
    metafields: [
      { id: "gid://mf/1", namespace: "custom", key: "frame", ownerType: "PRODUCT", type: { name: "single_line_text_field" }, access: { storefront: "NONE" } },
      { id: "gid://mf/2", namespace: "custom", key: "space", ownerType: "PRODUCT", type: { name: "number_integer" }, access: { storefront: "PUBLIC_READ" } },
    ],
  };
  const plan = planDefinitions(wanted, existing);
  assert.deepEqual(plan.createTypes.map((d) => d.type), ["material"]);
  assert.deepEqual(plan.addFields, [{ id: "gid://mo/1", type: "hero_slide", fields: [{ key: "rank", name: "Order", type: "number_integer" }] }]);
  assert.deepEqual(plan.createFields.map((d) => d.key), ["seats"]);
  assert.deepEqual(plan.openAccess.map((d) => d.key), ["frame"]);
  assert.match(plan.problems[0], /custom\.space is number_integer in Shopify, the catalogue wants single_line_text_field/);
});

// --- push, against a fake Admin API ---------------------------------------
let calls;
beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "defs-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_defstest";
  calls = [];
  const reply = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  let created = false;
  mock.method(globalThis, "fetch", async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (/metaobjectDefinitions\(/.test(query)) return reply({ metaobjectDefinitions: { nodes: created ? [{ id: "gid://mo/9", type: "color_swatch", fieldDefinitions: [] }] : [] } });
    if (/metafieldDefinitions\(/.test(query)) return reply({ metafieldDefinitions: { nodes: [] } });
    if (/metaobjectDefinitionCreate/.test(query)) { created = true; return reply({ metaobjectDefinitionCreate: { metaobjectDefinition: { id: "gid://mo/9", type: variables.definition.type }, userErrors: [] } }); }
    if (/metafieldDefinitionCreate/.test(query)) return reply({ metafieldDefinitionCreate: { createdDefinition: { id: "gid://mf/9" }, userErrors: [] } });
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
});
afterEach(() => {
  mock.restoreAll();
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
});

test("push creates types with storefront access first, then fields that point at the new type's id", async () => {
  const wanted = {
    metaobjects: [{ type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field" }] }],
    metafields: [{ ownerType: "PRODUCT", namespace: "custom", key: "color", name: "Color", type: "list.metaobject_reference", refType: "color_swatch" }],
  };
  const { typeIds } = await pushDefinitions(wanted, { log: () => {} });
  assert.deepEqual(typeIds, { color_swatch: "gid://mo/9" });
  const type = calls.find((c) => /metaobjectDefinitionCreate/.test(c.query)).variables.definition;
  assert.deepEqual(type.access, { storefront: "PUBLIC_READ" });
  assert.deepEqual(type.capabilities, { publishable: { enabled: true } });
  const field = calls.find((c) => /metafieldDefinitionCreate/.test(c.query)).variables.definition;
  assert.deepEqual(field.access, { storefront: "PUBLIC_READ" });
  assert.deepEqual(field.validations, [{ name: "metaobject_definition_id", value: "gid://mo/9" }]);
  assert.equal(field.refType, undefined);
});

test("push stops before writing when the plan has problems", async () => {
  const wanted = { metaobjects: [], metafields: [{ ownerType: "PRODUCT", namespace: "custom", key: "color", name: "Color", type: "list.metaobject_reference", refType: "nowhere" }] };
  await assert.rejects(pushDefinitions(wanted, { log: () => {} }), /no metaobject definition "nowhere"/);
  assert.equal(calls.filter((c) => /Create/.test(c.query)).length, 0);
});
```

Add to `scripts/catalogue/build.test.mjs` (keep its existing imports; add `mergeSources` and `readCatalogFile` if not imported, and `makeFixture` from `../test-support/fixture.mjs`):

```js
test("definitions and content entries from every source are merged", () => {
  const merged = mergeSources([
    { products: [], definitions: { metaobjects: [{ type: "material" }] }, metaobjects: [{ type: "material", handle: "oak", fields: { label: "Oak" } }] },
    { products: [], definitions: { metafields: [{ namespace: "custom", key: "seats" }] }, metaobjects: [{ type: "material", handle: "ash", fields: { label: "Ash" } }] },
  ]);
  assert.deepEqual(merged.definitions, { metaobjects: [{ type: "material" }], metafields: [{ namespace: "custom", key: "seats" }] });
  assert.deepEqual(merged.metaobjects.map((m) => m.handle), ["oak", "ash"]);
});

test("reading the catalogue keeps definitions and content entries", () => {
  const root = makeFixture({ "catalog.json": { collections: [], products: [], definitions: { metaobjects: [{ type: "material" }], metafields: [] }, metaobjects: [{ type: "material", handle: "oak", fields: {} }] } });
  const { catalog } = readCatalogFile(`${root}/catalog.json`);
  assert.equal(catalog.definitions.metaobjects[0].type, "material");
  assert.equal(catalog.metaobjects[0].handle, "oak");
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test scripts/catalogue/definitions.test.mjs scripts/catalogue/build.test.mjs`
Expected: FAIL, `Cannot find module './definitions.mjs'` and the two new build tests fail on `undefined`.

- [ ] **Step 3: Check Shopify's field names before writing queries**

WebFetch these and confirm each name used in Step 4. If one differs, use Shopify's name and say so in the commit message:
- `https://shopify.dev/docs/api/admin-graphql/latest/queries/metaobjectDefinitions` (`fieldDefinitions { key type { name } }`)
- `https://shopify.dev/docs/api/admin-graphql/latest/queries/metafieldDefinitions` (is `namespace` optional; `ownerType` required; `access { storefront }`)
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectDefinitionUpdate` (`fieldDefinitions: [{ create: {...} }]`)
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldDefinitionUpdate` (input `{ namespace, key, ownerType, access }`)

- [ ] **Step 4: Write `scripts/catalogue/definitions.mjs`**

```js
/**
 * Content definitions: the metaobject types (hero slides, reviews, a source's
 * swatches or materials) and the product metafield definitions the storefront
 * reads. The Storefront API returns null for a metafield whose definition has
 * no storefront access, so every metafield the catalogue sets gets one here.
 * Idempotent: keyed on type and namespace.key; never changes a field's type.
 * UNVERIFIED until run against a development store.
 */
import { adminGraphQL } from "../shopify/admin-client.mjs";

const PUBLIC = { storefront: "PUBLIC_READ" };
const TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
const KIT_TYPES = new Set(["hero_slide", "customer_review"]);

/** The kit's own types. The owner fills them in under Content > Metaobjects. */
export function kitDefinitions({ wantsReviews = false } = {}) {
  const metaobjects = [
    {
      type: "hero_slide",
      name: "Hero slide",
      displayNameKey: "title",
      fieldDefinitions: [
        { key: "title", name: "Title (blank: the product's name)", type: "single_line_text_field" },
        { key: "subtitle", name: "Subtitle", type: "multi_line_text_field" },
        { key: "image", name: "Image (blank: the product's photo)", type: "file_reference" },
        { key: "product", name: "Product", type: "product_reference" },
        { key: "link", name: "Link, a path like /collections/sofas", type: "single_line_text_field" },
        { key: "rank", name: "Order (1 shows first)", type: "number_integer" },
      ],
    },
  ];
  if (wantsReviews) {
    metaobjects.push({
      type: "customer_review",
      name: "Customer review",
      displayNameKey: "author",
      fieldDefinitions: [
        { key: "author", name: "Customer name", type: "single_line_text_field", required: true },
        { key: "rating", name: "Rating (1-5)", type: "number_integer", required: true, validations: [{ name: "min", value: "1" }, { name: "max", value: "5" }] },
        { key: "body", name: "Review", type: "multi_line_text_field", required: true },
        { key: "product", name: "Product", type: "product_reference" },
        { key: "location", name: "City", type: "single_line_text_field" },
        { key: "date", name: "Date", type: "date" },
      ],
    });
  }
  return { metaobjects, metafields: [] };
}

const humanise = (key) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isReference = (type) => /metaobject_reference$/.test(type ?? "");

/** Everything the catalogue needs defined: the kit's types, the source's own, and one field per metafield key used. */
export function wantedDefinitions(catalog, { wantsReviews = false } = {}) {
  const kit = kitDefinitions({ wantsReviews });
  const problems = [];
  const own = catalog.definitions?.metaobjects ?? [];
  for (const def of own) {
    if (KIT_TYPES.has(def.type)) problems.push(`${def.type} is a kit type; give the source's type another name`);
    else if (!TYPE_PATTERN.test(def.type ?? "")) problems.push(`metaobject type "${def.type}" must be lower_snake_case`);
    else if (!def.fieldDefinitions?.some((f) => f.key === def.displayNameKey)) problems.push(`${def.type}: displayNameKey "${def.displayNameKey}" is not one of its fields`);
  }
  const metaobjects = [...kit.metaobjects, ...own.filter((d) => !KIT_TYPES.has(d.type))];
  const types = new Set(metaobjects.map((d) => d.type));

  const fields = new Map();
  for (const def of [...kit.metafields, ...(catalog.definitions?.metafields ?? [])]) {
    fields.set(`${def.namespace}.${def.key}`, { ownerType: "PRODUCT", name: humanise(def.key), ...def });
  }
  for (const product of catalog.products ?? []) {
    for (const mf of product.metafields ?? []) {
      const id = `${mf.namespace}.${mf.key}`;
      const refType = isReference(mf.type) ? [...new Set((mf.refs ?? []).map((r) => r.split("/")[0]))] : [];
      if (refType.length > 1) problems.push(`${id} refers to several types (${refType.join(", ")}); one field holds one type`);
      const seen = fields.get(id);
      if (seen && seen.type !== mf.type) {
        problems.push(`${id} is set as ${seen.type} and as ${mf.type}; pick one`);
        continue;
      }
      if (!seen) {
        fields.set(id, { ownerType: "PRODUCT", namespace: mf.namespace, key: mf.key, name: humanise(mf.key), type: mf.type, ...(refType[0] && { refType: refType[0] }) });
      }
    }
  }
  for (const [id, def] of fields) {
    if (def.refType && !types.has(def.refType)) problems.push(`${id} refers to type "${def.refType}", which no definition declares`);
  }
  return { metaobjects, metafields: [...fields.values()], problems };
}

/** Pure: what to write, given what the store already has. */
export function planDefinitions(wanted, existing) {
  const problems = [];
  const haveTypes = new Map(existing.metaobjects.map((d) => [d.type, d]));
  const createTypes = [];
  const addFields = [];
  for (const def of wanted.metaobjects) {
    const have = haveTypes.get(def.type);
    if (!have) {
      createTypes.push(def);
      continue;
    }
    const haveFields = new Map(have.fieldDefinitions.map((f) => [f.key, f.type.name]));
    const missing = def.fieldDefinitions.filter((f) => !haveFields.has(f.key));
    for (const f of def.fieldDefinitions) {
      if (haveFields.has(f.key) && haveFields.get(f.key) !== f.type) problems.push(`${def.type}.${f.key} is ${haveFields.get(f.key)} in Shopify, the kit wants ${f.type}`);
    }
    if (missing.length) addFields.push({ id: have.id, type: def.type, fields: missing });
  }

  const haveFields = new Map(existing.metafields.map((d) => [`${d.ownerType}:${d.namespace}.${d.key}`, d]));
  const createFields = [];
  const openAccess = [];
  for (const def of wanted.metafields) {
    const have = haveFields.get(`${def.ownerType}:${def.namespace}.${def.key}`);
    if (!have) createFields.push(def);
    else if (have.type.name !== def.type) problems.push(`${def.namespace}.${def.key} is ${have.type.name} in Shopify, the catalogue wants ${def.type}`);
    else if (have.access?.storefront !== "PUBLIC_READ") openAccess.push(def);
  }
  return { createTypes, addFields, createFields, openAccess, problems };
}

const TYPES = `query { metaobjectDefinitions(first: 250) { nodes { id type fieldDefinitions { key type { name } } } } }`;
const FIELDS = `query($owner: MetafieldOwnerType!) { metafieldDefinitions(first: 250, ownerType: $owner) { nodes { id namespace key ownerType type { name } access { storefront } } } }`;
const CREATE_TYPE = `mutation($definition: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message code } } }`;
const UPDATE_TYPE = `mutation($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) { metaobjectDefinitionUpdate(id: $id, definition: $definition) { metaobjectDefinition { id } userErrors { field message code } } }`;
const CREATE_FIELD = `mutation($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } } }`;
const UPDATE_FIELD = `mutation($definition: MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition: $definition) { updatedDefinition { id } userErrors { field message code } } }`;

async function readExisting() {
  const metaobjects = (await adminGraphQL(TYPES)).metaobjectDefinitions.nodes;
  const metafields = (await adminGraphQL(FIELDS, { owner: "PRODUCT" })).metafieldDefinitions.nodes;
  return { metaobjects, metafields };
}

/** Reads the store, writes only the difference, and returns each type's id for reference fields and entries. */
export async function pushDefinitions(wanted, { log = console.log } = {}) {
  const plan = planDefinitions(wanted, await readExisting());
  const known = new Set(wanted.metaobjects.map((d) => d.type));
  for (const def of wanted.metafields) {
    if (def.refType && !known.has(def.refType)) plan.problems.push(`${def.namespace}.${def.key}: no metaobject definition "${def.refType}"`);
  }
  if (plan.problems.length) throw new Error(`definitions not written:\n  ${plan.problems.join("\n  ")}`);

  for (const def of plan.createTypes) {
    await adminGraphQL(CREATE_TYPE, { definition: { ...def, access: PUBLIC, capabilities: { publishable: { enabled: true } } } });
    log(`  + type ${def.type}`);
  }
  for (const { id, type, fields } of plan.addFields) {
    await adminGraphQL(UPDATE_TYPE, { id, definition: { fieldDefinitions: fields.map((f) => ({ create: f })) } });
    log(`  ~ type ${type}: added ${fields.map((f) => f.key).join(", ")}`);
  }
  const typeIds = Object.fromEntries((await adminGraphQL(TYPES)).metaobjectDefinitions.nodes.map((d) => [d.type, d.id]));

  for (const { refType, ...def } of plan.createFields) {
    const validations = refType ? [{ name: "metaobject_definition_id", value: typeIds[refType] }] : [];
    await adminGraphQL(CREATE_FIELD, { definition: { ...def, validations, access: PUBLIC } });
    log(`  + field ${def.namespace}.${def.key} (${def.type})`);
  }
  for (const def of plan.openAccess) {
    await adminGraphQL(UPDATE_FIELD, { definition: { namespace: def.namespace, key: def.key, ownerType: def.ownerType, access: PUBLIC } });
    log(`  ~ field ${def.namespace}.${def.key}: storefront can read it now`);
  }
  const untouched = wanted.metaobjects.length + wanted.metafields.length - plan.createTypes.length - plan.createFields.length - plan.openAccess.length;
  log(`  = ${untouched} definition(s) already right`);
  return { typeIds };
}
```

- [ ] **Step 5: Carry definitions and entries through `build.mjs`**

In `mergeSources`, change the return to:

```js
  const definitions = {
    metaobjects: results.flatMap((r) => r.definitions?.metaobjects ?? []),
    metafields: results.flatMap((r) => r.definitions?.metafields ?? []),
  };
  return { collections, products: results.flatMap((r) => r.products ?? []), definitions, metaobjects: results.flatMap((r) => r.metaobjects ?? []) };
```

In `readCatalogFile`, change the catalogue it returns to:

```js
    return {
      ok: true,
      catalog: {
        collections: raw.collections ?? [],
        products: raw.products ?? [],
        definitions: { metaobjects: raw.definitions?.metaobjects ?? [], metafields: raw.definitions?.metafields ?? [] },
        metaobjects: raw.metaobjects ?? [],
      },
      problem: null,
    };
```

In `buildCatalogue`, after `validateCatalog`, add the definition problems so a bad source fails at build time, not at push time:

```js
  const problems = [
    ...validateCatalog(catalog, { tracksInventory: config.tracksInventory }),
    ...wantedDefinitions(catalog, { wantsReviews: config.wantsReviews }).problems,
  ];
```

with `import { wantedDefinitions } from "./definitions.mjs";` at the top.

- [ ] **Step 6: Add the scopes and the CLI command**

In `scripts/shopify/admin-client.mjs`, add to `SCOPES`:

```js
  content: ["write_metaobject_definitions", "write_metaobjects"],
```

In `scripts/setup/cli.mjs`, import `{ pushDefinitions, wantedDefinitions }` from `../catalogue/definitions.mjs`, add `| definitions [--dry-run]` to `USAGE` after `catalogue-verify`, and add this case after `catalogue-verify`:

```js
  case "definitions": {
    const config = loadConfig();
    const file = readCatalogFile();
    const catalog = file.ok ? file.catalog : { products: [], definitions: { metaobjects: [], metafields: [] } };
    if (!file.ok) info("no data/catalog.json yet: only the kit's own types");
    const wanted = wantedDefinitions(catalog, { wantsReviews: config.wantsReviews });
    wanted.problems.forEach((p) => bad(p));
    if (wanted.problems.length) process.exit(1);
    heading(`Definitions  ${wanted.metaobjects.length} content types, ${wanted.metafields.length} product fields`);
    if (flags["dry-run"]) {
      wanted.metaobjects.forEach((d) => info(`type  ${d.type}: ${d.fieldDefinitions.map((f) => f.key).join(", ")}`));
      wanted.metafields.forEach((d) => info(`field ${d.namespace}.${d.key} (${d.type})`));
      ok("dry run, nothing was written");
      break;
    }
    await pushDefinitions(wanted);
    ok("definitions in place; the storefront can read every one");
    break;
  }
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `pnpm test:scripts`
Expected: PASS, including the existing preflight/scope tests. If a test pins the exact scope list, update it to include the two new scopes.

- [ ] **Step 8: Commit**

```bash
git add scripts/catalogue/definitions.mjs scripts/catalogue/definitions.test.mjs scripts/catalogue/build.mjs scripts/catalogue/build.test.mjs scripts/shopify/admin-client.mjs scripts/setup/cli.mjs
git commit -m "feat(kit): create content definitions so the storefront can read every metafield, plus hero and review types"
```

---

### Task 2: Content entries (swatches, materials) and references from products

**Files:**
- Create: `scripts/catalogue/metaobjects.mjs`, `scripts/catalogue/metaobjects.test.mjs`
- Modify: `scripts/catalogue/format.mjs`, `scripts/catalogue/format.test.mjs`
- Modify: `scripts/catalogue/build-input.mjs`, `scripts/catalogue/build-input.test.mjs`
- Modify: `scripts/catalogue/push.mjs`, `scripts/catalogue/push-flow.test.mjs`

**Interfaces:**
- Consumes: `wantedDefinitions`, `pushDefinitions` (Task 1).
- Produces:
  - Catalogue entry shape: `{ type: string, handle: string, fields: Record<string, string | number | boolean> }` in `catalog.metaobjects`.
  - Product metafield with references: `{ namespace, key, type: "metaobject_reference" | "list.metaobject_reference", refs: ["<type>/<handle>", ...] }` (no `value`).
  - `validateEntries(entries, metaobjectDefs): string[]`
  - `pushEntries(entries, { log }): Promise<Record<string, string>>` mapping `"type/handle"` to the entry's id.
  - `resolveMetafields(metafields, refIds): Array<{ namespace, key, type, value }>`; `buildProductInput(product, { ..., refIds })`.

- [ ] **Step 1: Write the failing tests**

`scripts/catalogue/metaobjects.test.mjs`:

```js
import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validateEntries, pushEntries } from "./metaobjects.mjs";

const swatch = { type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field", required: true }, { key: "hex", name: "Hex", type: "single_line_text_field" }] };

test("entries must use a defined type, known fields, required fields and unique handles", () => {
  const problems = validateEntries(
    [
      { type: "color_swatch", handle: "grey", fields: { label: "Grey", hex: "#888" } },
      { type: "color_swatch", handle: "grey", fields: { label: "Grey again" } },
      { type: "color_swatch", handle: "Blue!", fields: { label: "Blue" } },
      { type: "color_swatch", handle: "red", fields: { hex: "#f00", shade: "dark" } },
      { type: "material", handle: "oak", fields: { label: "Oak" } },
    ],
    [swatch]
  );
  assert.deepEqual(problems, [
    "duplicate entry color_swatch/grey",
    'entry handle not url-safe: "color_swatch/Blue!"',
    "color_swatch/red: missing required field label",
    'color_swatch/red: field "shade" is not in the color_swatch definition',
    'material/oak: no definition for type "material"',
  ]);
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
});

test("entries are upserted by handle, published, with every value sent as a string", async () => {
  process.env.SHOPIFY_STORE_DOMAIN = "entries-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_entriestest";
  const sent = [];
  mock.method(globalThis, "fetch", async (_url, init) => {
    const { variables } = JSON.parse(init.body);
    sent.push(variables);
    return new Response(JSON.stringify({ data: { metaobjectUpsert: { metaobject: { id: `gid://mo-entry/${variables.handle.handle}` }, userErrors: [] } } }), { status: 200 });
  });
  const ids = await pushEntries([{ type: "color_swatch", handle: "grey", fields: { label: "Grey", sort: 2 } }], { log: () => {} });
  assert.deepEqual(ids, { "color_swatch/grey": "gid://mo-entry/grey" });
  assert.deepEqual(sent[0], {
    handle: { type: "color_swatch", handle: "grey" },
    metaobject: { fields: [{ key: "label", value: "Grey" }, { key: "sort", value: "2" }], capabilities: { publishable: { status: "ACTIVE" } } },
  });
});
```

Add to `scripts/catalogue/format.test.mjs` (it already imports `validateCatalog`):

```js
test("a reference metafield names its entries in refs, and they must exist", () => {
  const catalog = {
    collections: [],
    metaobjects: [{ type: "color_swatch", handle: "grey", fields: { label: "Grey" } }],
    products: [
      { handle: "a", title: "A", variants: [{ sku: "1", price: "1" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }] },
      { handle: "b", title: "B", variants: [{ sku: "2", price: "1" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/blue"] }] },
      { handle: "c", title: "C", variants: [{ sku: "3", price: "1" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", value: "[\"gid://x\"]" }] },
      { handle: "d", title: "D", variants: [{ sku: "4", price: "1" }], metafields: [{ namespace: "custom", key: "main", type: "metaobject_reference", refs: ["color_swatch/grey", "color_swatch/grey"] }] },
    ],
  };
  assert.deepEqual(validateCatalog(catalog), [
    "b: metafield color refers to color_swatch/blue, which is not in the catalogue's metaobjects",
    "c: metafield color is a reference, so it needs refs: [\"<type>/<handle>\"] instead of a value",
    "d: metafield main holds one reference, refs has 2",
  ]);
});
```

Add to `scripts/catalogue/build-input.test.mjs` (it already imports `buildProductInput`; also import `resolveMetafields`):

```js
test("refs become entry ids: a JSON list for list types, one id otherwise", () => {
  const refIds = { "color_swatch/grey": "gid://e/1", "color_swatch/oak": "gid://e/2" };
  assert.deepEqual(
    resolveMetafields(
      [
        { namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey", "color_swatch/oak"] },
        { namespace: "custom", key: "main", type: "metaobject_reference", refs: ["color_swatch/grey"] },
        { namespace: "custom", key: "seats", type: "number_integer", value: "3" },
      ],
      refIds
    ),
    [
      { namespace: "custom", key: "color", type: "list.metaobject_reference", value: '["gid://e/1","gid://e/2"]' },
      { namespace: "custom", key: "main", type: "metaobject_reference", value: "gid://e/1" },
      { namespace: "custom", key: "seats", type: "number_integer", value: "3" },
    ]
  );
});

test("a ref with no id stops the push instead of sending a broken field", () => {
  assert.throws(() => resolveMetafields([{ namespace: "custom", key: "c", type: "metaobject_reference", refs: ["color_swatch/x"] }], {}), /color_swatch\/x has no id/);
});
```

In `scripts/catalogue/push-flow.test.mjs`, extend `fakeShopify`'s handler (before the final `throw`) so the push's new calls are answered:

```js
    if (/metaobjectDefinitions\(/.test(query)) return reply({ metaobjectDefinitions: { nodes: [{ id: "gid://mo/hero", type: "hero_slide", fieldDefinitions: [{ key: "title", type: { name: "single_line_text_field" } }, { key: "subtitle", type: { name: "multi_line_text_field" } }, { key: "image", type: { name: "file_reference" } }, { key: "product", type: { name: "product_reference" } }, { key: "link", type: { name: "single_line_text_field" } }, { key: "rank", type: { name: "number_integer" } }] }] } });
    if (/metafieldDefinitions\(/.test(query)) return reply({ metafieldDefinitions: { nodes: [] } });
    if (/metaobjectUpsert/.test(query)) return reply({ metaobjectUpsert: { metaobject: { id: `gid://entry/${variables.handle.handle}` }, userErrors: [] } });
```

and add:

```js
test("definitions are read before collections, so product fields land in readable definitions", async () => {
  const { handler, calls } = fakeShopify();
  mock.method(globalThis, "fetch", handler);
  await pushCatalogue({ config: untracked, catalog });
  const first = calls.findIndex((c) => /metaobjectDefinitions\(/.test(c.query));
  const firstCollection = calls.findIndex((c) => /collectionByHandle/.test(c.query));
  assert.ok(first >= 0 && first < firstCollection);
});
```

(If `fakeShopify` is called with `mock.method(globalThis, "fetch", ...)` differently in the file, follow the file's own pattern.)

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test scripts/catalogue/metaobjects.test.mjs scripts/catalogue/format.test.mjs scripts/catalogue/build-input.test.mjs scripts/catalogue/push-flow.test.mjs`
Expected: FAIL (`Cannot find module './metaobjects.mjs'`, `resolveMetafields` is not a function, new format test gets `[]`, push-flow test fails the order assertion).

- [ ] **Step 3: Write `scripts/catalogue/metaobjects.mjs`**

```js
/**
 * Content entries a source supplies (colour swatches, materials...): validated
 * against their definitions, then upserted by type and handle, published, so a
 * re-run updates and never duplicates. UNVERIFIED until run against a development store.
 */
import { adminGraphQL } from "../shopify/admin-client.mjs";
import { HANDLE_PATTERN } from "./format.mjs";

export function validateEntries(entries = [], definitions = []) {
  const problems = [];
  const defs = new Map(definitions.map((d) => [d.type, d]));
  const seen = new Set();
  for (const entry of entries) {
    const id = `${entry.type}/${entry.handle}`;
    if (seen.has(id)) {
      problems.push(`duplicate entry ${id}`);
      continue;
    }
    seen.add(id);
    if (!HANDLE_PATTERN.test(entry.handle ?? "")) {
      problems.push(`entry handle not url-safe: "${id}"`);
      continue;
    }
    const def = defs.get(entry.type);
    if (!def) {
      problems.push(`${id}: no definition for type "${entry.type}"`);
      continue;
    }
    const fields = entry.fields ?? {};
    for (const f of def.fieldDefinitions) if (f.required && (fields[f.key] ?? "") === "") problems.push(`${id}: missing required field ${f.key}`);
    const known = new Set(def.fieldDefinitions.map((f) => f.key));
    for (const key of Object.keys(fields)) if (!known.has(key)) problems.push(`${id}: field "${key}" is not in the ${entry.type} definition`);
  }
  return problems;
}

const UPSERT = `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id } userErrors { field message code } } }`;

/** Returns { "type/handle": id } for every entry, for product reference fields. */
export async function pushEntries(entries = [], { log = console.log } = {}) {
  const ids = {};
  for (const entry of entries) {
    const data = await adminGraphQL(UPSERT, {
      handle: { type: entry.type, handle: entry.handle },
      metaobject: {
        fields: Object.entries(entry.fields ?? {}).map(([key, value]) => ({ key, value: String(value) })),
        capabilities: { publishable: { status: "ACTIVE" } },
      },
    });
    ids[`${entry.type}/${entry.handle}`] = data.metaobjectUpsert.metaobject.id;
  }
  if (entries.length) log(`  = ${entries.length} content entries upserted`);
  return ids;
}
```

- [ ] **Step 4: Add the `refs` rules to `format.mjs`**

Replace the metafield loop inside `validateCatalog` with:

```js
    for (const metafield of product.metafields ?? []) {
      if (!metafield.namespace || !metafield.key || !metafield.type) problems.push(`${id}: metafield needs namespace, key and type`);
      if (/metaobject_reference$/.test(metafield.type ?? "")) {
        if (!Array.isArray(metafield.refs) || !metafield.refs.length) {
          problems.push(`${id}: metafield ${metafield.key} is a reference, so it needs refs: ["<type>/<handle>"] instead of a value`);
          continue;
        }
        if (!metafield.type.startsWith("list.") && metafield.refs.length !== 1) problems.push(`${id}: metafield ${metafield.key} holds one reference, refs has ${metafield.refs.length}`);
        for (const ref of metafield.refs) {
          if (!entryIds.has(ref)) problems.push(`${id}: metafield ${metafield.key} refers to ${ref}, which is not in the catalogue's metaobjects`);
        }
        continue;
      }
      if (metafield.type?.startsWith("list.") && typeof metafield.value === "string" && !metafield.value.startsWith("[")) {
        problems.push(`${id}: metafield ${metafield.key} is a list type, so value must be a JSON-encoded array string`);
      }
    }
```

Change the signature line to `export function validateCatalog({ collections = [], products = [], metaobjects = [] }, { tracksInventory = false } = {}) {` and add after `const skus = new Set();`:

```js
  const entryIds = new Set(metaobjects.map((m) => `${m.type}/${m.handle}`));
```

- [ ] **Step 5: Resolve refs in `build-input.mjs`**

Add above `buildProductInput`:

```js
/** Refs ("type/handle") become the entry ids Shopify stores: a JSON list for list types, one id otherwise. */
export function resolveMetafields(metafields = [], refIds = {}) {
  return metafields.map(({ refs, ...metafield }) => {
    if (!refs) return metafield;
    const ids = refs.map((ref) => {
      if (!refIds[ref]) throw new Error(`${ref} has no id; push the content entries first`);
      return refIds[ref];
    });
    return { ...metafield, value: metafield.type.startsWith("list.") ? JSON.stringify(ids) : ids[0] };
  });
}
```

Change the signature to `export function buildProductInput(product, { collectionIds = {}, locationId, tracksInventory, skipImages = false, refIds = {} })` and the metafields line to:

```js
    ...(product.metafields?.length && { metafields: resolveMetafields(product.metafields, refIds) }),
```

- [ ] **Step 6: Push in order in `push.mjs`**

Import `{ pushDefinitions, wantedDefinitions }` from `./definitions.mjs` and `{ pushEntries, validateEntries }` from `./metaobjects.mjs`. In `pushCatalogue`, replace `const problems = validateCatalog(catalog, { tracksInventory });` with:

```js
  const wanted = wantedDefinitions(catalog, { wantsReviews: config.wantsReviews });
  const problems = [...validateCatalog(catalog, { tracksInventory }), ...wanted.problems, ...validateEntries(catalog.metaobjects, wanted.metaobjects)];
```

In the dry-run branch, before `describePlan(...)`, add:

```js
    info(`definitions: ${wanted.metaobjects.length} content types, ${wanted.metafields.length} product fields; ${(catalog.metaobjects ?? []).length} content entries`);
```

After the `heading(\`Publishing to: ...\`)` line, add:

```js
  heading("Definitions and content entries");
  await pushDefinitions(wanted);
  const refIds = await pushEntries(catalog.metaobjects ?? []);
```

and pass `refIds` into `buildProductInput(product, { collectionIds, locationId: location, tracksInventory, skipImages, refIds })`.

- [ ] **Step 7: Run all tests**

Run: `pnpm test:scripts`
Expected: PASS. Existing push-flow tests that count calls may need the new definitions calls allowed; adjust counts only for definition/entry queries, never for product or collection calls.

- [ ] **Step 8: Commit**

```bash
git add scripts/catalogue
git commit -m "feat(kit): content entries from a source, and product fields that reference them by handle"
```

---

### Task 3: Re-upload photos from hosts that block Shopify

Some supplier sites answer Shopify's image fetcher with a 403 while serving browsers fine (woodwell.gr did). The media shows `FAILED` and the product has no pictures. The fix is to download each photo and upload it to Shopify Files, then give Shopify its own CDN url.

**Files:**
- Create: `scripts/catalogue/rehost.mjs`, `scripts/catalogue/rehost.test.mjs`
- Modify: `scripts/catalogue/push.mjs`, `scripts/setup/cli.mjs`, `scripts/catalogue/verify.mjs` (hint text only)

**Interfaces:**
- Produces:
  - `IMAGE_MAP_FILE` = `data/image-map.json` (committed: it saves re-uploading on every run)
  - `rehostTargets(catalog, hosts: string[]): string[]`
  - `applyImageMap(catalog, map: Record<string,string>): catalog` (pure, returns a copy)
  - `uploadImage(url): Promise<string>` (Shopify CDN url)
  - `rehostImages(urls, { mapFile, upload, log }): Promise<{ map, failed: Array<{ url, error }> }>`
  - `pushCatalogue({ ..., rehost: string[] })`

- [ ] **Step 1: Write the failing tests**

`scripts/catalogue/rehost.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test scripts/catalogue/rehost.test.mjs`
Expected: FAIL, `Cannot find module './rehost.mjs'`.

- [ ] **Step 3: Write `scripts/catalogue/rehost.mjs`**

```js
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
```

- [ ] **Step 4: Use it in the push and the CLI**

In `push.mjs`, import `{ IMAGE_MAP_FILE, applyImageMap, rehostImages, rehostTargets }` from `./rehost.mjs` and `existsSync, readFileSync` from `node:fs`. Add `rehost = []` to `pushCatalogue`'s options. Right after the dry-run branch returns (before `pickLocation`), add:

```js
  if (rehost.length && !skipImages) {
    heading(`Re-uploading photos from ${rehost.join(", ")}`);
    const { failed } = await rehostImages(rehostTargets(catalog, rehost));
    failed.forEach((f) => bad(`${f.url}: ${f.error}`));
    if (failed.length) info(`${failed.length} photo(s) not re-uploaded. Those products keep the supplier url; list them for the owner.`);
  }
  // Earlier runs' uploads count even without --rehost, so a re-run never goes back to a blocked url.
  if (existsSync(IMAGE_MAP_FILE)) catalog = applyImageMap(catalog, JSON.parse(readFileSync(IMAGE_MAP_FILE, "utf8")));
```

(`catalog` is a destructured parameter; it can be reassigned.) In the dry-run branch add `if (rehost.length) info(\`would re-upload ${rehostTargets(catalog, rehost).length} photo(s) from ${rehost.join(", ")}\`);`.

In `cli.mjs`, `catalogue` case, pass `rehost: typeof flags.rehost === "string" ? flags.rehost.split(",").map((h) => h.trim()).filter(Boolean) : []`, and add ` [--rehost=host,...]` to the catalogue part of `USAGE`.

In `verify.mjs`, extend the images problem text to end with: `" If a supplier's site blocks Shopify (media FAILED), push again with --rehost=<that host>."`

- [ ] **Step 5: Run all tests**

Run: `pnpm test:scripts`
Expected: PASS. If a verify test pins the exact images message, update it to the new text.

- [ ] **Step 6: Commit**

```bash
git add scripts/catalogue scripts/setup/cli.mjs
git commit -m "feat(kit): re-upload photos from supplier hosts that block Shopify, with a saved url map"
```

---

### Task 4: Reviews and hero slides read from Shopify

**Files:**
- Create: `src/lib/shopify/metaobjects.ts` (pure, browser-safe), `scripts/shopify/sdk-metaobjects.test.mjs`
- Modify: `src/lib/shopify/queries.ts` (`metaobjectsQuery`), `src/lib/shopify/types.ts`, `src/lib/shopify/content.ts`, `src/lib/shopify/index.ts` (export `./metaobjects`)

**Interfaces:**
- Consumes: the `hero_slide` and `customer_review` field keys from Task 1 (`title, subtitle, image, product, link, rank`; `author, rating, body, product, location, date`).
- Produces (types.ts):

```ts
export interface EntryProduct { handle: string; title: string; featuredImage: ShopifyImage | null }
export interface MetaobjectField { value: string | null; image: ShopifyImage | null; product: EntryProduct | null; collection: { handle: string; title: string } | null; entries: Array<{ handle: string; fields: Record<string, string | null> }> }
export interface MetaobjectEntry { handle: string; updatedAt: string; fields: Record<string, MetaobjectField> }
export interface Review { handle: string; author: string; rating: number; body: string; location: string | null; date: string | null; product: EntryProduct | null }
export interface HeroSlide { handle: string; title: string; subtitle: string | null; image: ShopifyImage; href: string | null; product: EntryProduct | null }
```

- Produces (metaobjects.ts): `toEntry(raw): MetaobjectEntry`, `toReview(entry): Review | null`, `toHeroSlide(entry): HeroSlide | null`, `sortHeroSlides(entries): HeroSlide[]`, `reviewSummary(reviews): { count: number; average: number | null }`.
- Produces (content.ts): `getMetaobjects(type, { first = 50 }): Promise<MetaobjectEntry[]>`, `getReviews({ product?: string; first?: number }): Promise<Review[]>`, `getHeroSlides(): Promise<HeroSlide[]>`.

- [ ] **Step 1: Write the failing tests**

`scripts/shopify/sdk-metaobjects.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

const img = (url) => ({ url, altText: null, width: 10, height: 10 });
const field = (key, value, reference = null) => ({ key, value, reference, references: null });
const entry = (handle, fields, updatedAt = "2026-01-01T00:00:00Z") => ({ handle, updatedAt, fields });
const product = { __typename: "Product", handle: "milano", title: "Milano", featuredImage: img("https://cdn.shopify.com/m.jpg") };

let sent;
function answer(nodes) {
  globalThis.fetch = async (_u, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: { metaobjects: { nodes } } }), { status: 200 });
  };
}

test("reviews keep only real ones: a name, a text and a whole rating from 1 to 5", async () => {
  answer([
    entry("r1", [field("author", "Maria"), field("rating", "5"), field("body", "Great sofa"), field("date", "2026-03-02"), field("product", "gid://p/1", product)]),
    entry("r2", [field("author", "Nikos"), field("rating", "7"), field("body", "x")]),
    entry("r3", [field("author", ""), field("rating", "4"), field("body", "x")]),
    entry("r4", [field("author", "Eleni"), field("rating", "4"), field("body", "Good"), field("date", "2026-05-01")]),
  ]);
  const reviews = await sdk.getReviews();
  assert.equal(sent.variables.type, "customer_review");
  assert.deepEqual(reviews.map((r) => r.handle), ["r4", "r1"]);
  assert.deepEqual(reviews[1], { handle: "r1", author: "Maria", rating: 5, body: "Great sofa", location: null, date: "2026-03-02", product: { handle: "milano", title: "Milano", featuredImage: img("https://cdn.shopify.com/m.jpg") } });
});

test("reviews for one product, and their summary", async () => {
  answer([
    entry("r1", [field("author", "Maria"), field("rating", "5"), field("body", "a"), field("product", "gid://p/1", product)]),
    entry("r2", [field("author", "Eleni"), field("rating", "4"), field("body", "b")]),
    entry("r3", [field("author", "Kostas"), field("rating", "4"), field("body", "c"), field("product", "gid://p/1", product)]),
  ]);
  const reviews = await sdk.getReviews({ product: "milano" });
  assert.deepEqual(reviews.map((r) => r.handle).sort(), ["r1", "r3"]);
  assert.deepEqual(sdk.reviewSummary(reviews), { count: 2, average: 4.5 });
  assert.deepEqual(sdk.reviewSummary([]), { count: 0, average: null });
});

test("hero slides: own words and picture first, the product's as fallback, in the owner's order", async () => {
  answer([
    entry("b", [field("rank", "2"), field("product", "gid://p/1", product)]),
    entry("a", [field("rank", "1"), field("title", "Summer sale"), field("subtitle", "Up to the owner"), field("image", "gid://i/1", { __typename: "MediaImage", image: img("https://cdn.shopify.com/hero.jpg") }), field("link", "/collections/sale")]),
    entry("c", [field("title", "No picture at all")]),
    entry("d", [field("product", "gid://p/1", product)]),
  ]);
  const slides = await sdk.getHeroSlides();
  assert.equal(sent.variables.type, "hero_slide");
  assert.deepEqual(slides.map((s) => s.handle), ["a", "b", "d"]);
  assert.deepEqual(slides[0], { handle: "a", title: "Summer sale", subtitle: "Up to the owner", image: img("https://cdn.shopify.com/hero.jpg"), href: "/collections/sale", product: null });
  assert.equal(slides[1].title, "Milano");
  assert.equal(slides[1].image.url, "https://cdn.shopify.com/m.jpg");
  assert.equal(slides[1].href, null);
});

test("a type the shop never defined is an empty list", async () => {
  answer([]);
  assert.deepEqual(await sdk.getMetaobjects("anything"), []);
});

test("entries are content: cached for an hour under the content tag", async () => {
  let init;
  globalThis.fetch = async (_u, i) => { init = i; return new Response(JSON.stringify({ data: { metaobjects: { nodes: [] } } }), { status: 200 }); };
  await sdk.getMetaobjects("hero_slide");
  assert.equal(init.cache, "force-cache");
  assert.deepEqual(init.next.tags, ["content"]);
});

test("referenced entries (a swatch list) come back with their fields", async () => {
  answer([entry("x", [{ key: "colors", value: "[\"gid://e/1\"]", reference: null, references: { nodes: [{ __typename: "Metaobject", handle: "grey", fields: [{ key: "label", value: "Grey" }, { key: "hex", value: "#888" }] }] } }])]);
  const [x] = await sdk.getMetaobjects("anything");
  assert.deepEqual(x.fields.colors.entries, [{ handle: "grey", fields: { label: "Grey", hex: "#888" } }]);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test scripts/shopify/sdk-metaobjects.test.mjs`
Expected: FAIL, `sdk.getReviews is not a function`.

- [ ] **Step 3: Add the query and types**

In `src/lib/shopify/queries.ts`, after `pageQuery`:

```ts
/** Content entries of one type (Content > Metaobjects in the admin). Unknown types return no nodes. */
export const metaobjectsQuery = /* GraphQL */ `
  query GetMetaobjects($type: String!, $first: Int!) {
    metaobjects(type: $type, first: $first) {
      nodes {
        handle
        updatedAt
        fields {
          key
          value
          reference {
            __typename
            ... on MediaImage {
              image {
                ...ImageFragment
              }
            }
            ... on Product {
              handle
              title
              featuredImage {
                ...ImageFragment
              }
            }
            ... on Collection {
              handle
              title
            }
          }
          references(first: 25) {
            nodes {
              __typename
              ... on Metaobject {
                handle
                fields {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  }
  ${imageFragment}
`;
```

In `src/lib/shopify/types.ts`, add the five interfaces from the Interfaces block above.

- [ ] **Step 4: Write `src/lib/shopify/metaobjects.ts`**

```ts
/**
 * Pure mappers for content entries (Content > Metaobjects): reviews and hero
 * slides the owner types into the Shopify admin. Browser-safe: no fetch here.
 * Anything incomplete is dropped, never filled in with made-up words or pictures.
 */
import type { EntryProduct, HeroSlide, MetaobjectEntry, MetaobjectField, Review, ShopifyImage } from "./types";

interface RawField {
  key: string;
  value: string | null;
  reference: { __typename: string; image?: ShopifyImage; handle?: string; title?: string; featuredImage?: ShopifyImage | null } | null;
  references: { nodes: Array<{ __typename: string; handle?: string; fields?: Array<{ key: string; value: string | null }> }> } | null;
}
export interface RawEntry { handle: string; updatedAt: string; fields: RawField[] }

const text = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function toEntry(raw: RawEntry): MetaobjectEntry {
  const fields: Record<string, MetaobjectField> = {};
  for (const f of raw.fields) {
    const ref = f.reference;
    fields[f.key] = {
      value: text(f.value),
      image: ref?.__typename === "MediaImage" ? ref.image ?? null : null,
      product: ref?.__typename === "Product" ? { handle: ref.handle!, title: ref.title!, featuredImage: ref.featuredImage ?? null } : null,
      collection: ref?.__typename === "Collection" ? { handle: ref.handle!, title: ref.title! } : null,
      entries: (f.references?.nodes ?? [])
        .filter((n) => n.__typename === "Metaobject")
        .map((n) => ({ handle: n.handle!, fields: Object.fromEntries((n.fields ?? []).map((x) => [x.key, text(x.value)])) })),
    };
  }
  return { handle: raw.handle, updatedAt: raw.updatedAt, fields };
}

const value = (e: MetaobjectEntry, key: string) => e.fields[key]?.value ?? null;
const productOf = (e: MetaobjectEntry): EntryProduct | null => e.fields.product?.product ?? null;

export function toReview(e: MetaobjectEntry): Review | null {
  const author = value(e, "author");
  const body = value(e, "body");
  const rating = Number(value(e, "rating"));
  if (!author || !body || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return { handle: e.handle, author, rating, body, location: value(e, "location"), date: value(e, "date"), product: productOf(e) };
}

/** Newest first by the owner's date; undated reviews go last. */
export function sortReviews(reviews: Review[]): Review[] {
  return [...reviews].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function reviewSummary(reviews: Review[]): { count: number; average: number | null } {
  if (!reviews.length) return { count: 0, average: null };
  const average = reviews.reduce((n, r) => n + r.rating, 0) / reviews.length;
  return { count: reviews.length, average: Math.round(average * 10) / 10 };
}

export function toHeroSlide(e: MetaobjectEntry): (HeroSlide & { rank: number | null }) | null {
  const product = productOf(e);
  const image = e.fields.image?.image ?? product?.featuredImage ?? null;
  const title = value(e, "title") ?? product?.title ?? null;
  if (!image || !title) return null;
  const rank = Number(value(e, "rank"));
  return { handle: e.handle, title, subtitle: value(e, "subtitle"), image, href: value(e, "link"), product, rank: value(e, "rank") !== null && Number.isInteger(rank) ? rank : null };
}

/** The owner's order (1 first); slides without an order go last, by handle. */
export function sortHeroSlides(entries: MetaobjectEntry[]): HeroSlide[] {
  return entries
    .map(toHeroSlide)
    .filter((s): s is HeroSlide & { rank: number | null } => s !== null)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.handle.localeCompare(b.handle))
    .map(({ rank: _rank, ...slide }) => slide);
}
```

- [ ] **Step 5: Add the reads to `content.ts`**

```ts
import { metaobjectsQuery } from "./queries";
import { toEntry, toReview, sortReviews, sortHeroSlides, type RawEntry } from "./metaobjects";
import type { MetaobjectEntry, Review, HeroSlide } from "./types";

/** Entries of one content type. A type the shop has not defined is an empty list. */
export async function getMetaobjects(type: string, { first = 50 }: { first?: number } = {}): Promise<MetaobjectEntry[]> {
  const data = await read<{ metaobjects: { nodes: RawEntry[] } }>(metaobjectsQuery, { type, first });
  return data.metaobjects.nodes.map(toEntry);
}

/**
 * Reviews the owner entered under Content > Metaobjects > Customer review.
 * The Storefront API cannot filter entries by field, so one product's reviews
 * are picked from the newest 250.
 */
export async function getReviews({ product, first = 250 }: { product?: string; first?: number } = {}): Promise<Review[]> {
  const reviews = (await getMetaobjects("customer_review", { first })).map(toReview).filter((r): r is Review => r !== null);
  return sortReviews(product ? reviews.filter((r) => r.product?.handle === product) : reviews);
}

/** Hero slides from Content > Metaobjects > Hero slide. Empty when the owner made none: hide the hero. */
export async function getHeroSlides(): Promise<HeroSlide[]> {
  return sortHeroSlides(await getMetaobjects("hero_slide", { first: 20 }));
}
```

(Merge the imports into the existing import lines at the top of `content.ts`.) In `index.ts`, add `export * from "./metaobjects";` next to `export * from "./menu";`.

- [ ] **Step 6: Run the tests, the query validator and the type check**

Run: `node --test scripts/shopify/sdk-metaobjects.test.mjs && pnpm test:scripts && pnpm shop-setup validate-queries && npx tsc --noEmit`
Expected: PASS; `validate-queries` lists `GetMetaobjects` as valid against the Storefront schema. Fix any schema complaint by using the schema's field name.

- [ ] **Step 7: Commit**

```bash
git add src/lib/shopify scripts/shopify/sdk-metaobjects.test.mjs
git commit -m "feat(kit): read reviews and hero slides the owner enters in Shopify"
```

---

### Task 5: Contact form and newsletter sign-up, emailed to the owner

**Files:**
- Create: `src/lib/shopify/contact.ts`, `src/app/api/contact/route.ts`, `scripts/shopify/contact.test.mjs`
- Modify: `scripts/frontend/kit.mjs` (`ROUTES` gains `"contact"`), `scripts/frontend/kit.test.mjs` if it pins the route list
- Modify: `scripts/shopify/client-boundary.test.mjs` only if it needs `contact.ts` listed as server-only

**Interfaces:**
- Produces: `POST /api/contact` with JSON `{ type: "contact", name, email, phone?, subject?, message, website? }` or `{ type: "newsletter", email, website? }`. Answers `{ ok: true }` or `{ ok: false, error: "invalid_json" | "invalid_email" | "missing_fields" | "not_configured" | "send_failed" }` with 400 / 503 / 502. Error codes, not sentences, so the frontend writes them in the shop's language.
- Env: `RESEND_API_KEY`, `CONTACT_FROM` (a sender on a domain verified in Resend, e.g. `Shop <noreply@shop.gr>`), `CONTACT_TO` (comma-separated inboxes).
- `contact.ts` exports: `mailConfig(env)`, `parseForm(body)`, `sendForm(message, config)`, `escapeHtml`, `isEmail`.

- [ ] **Step 1: Write the failing tests**

`scripts/shopify/contact.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const contact = await loadSdk("contact");

test("no key, sender or inbox means not configured, never a typed-in fallback", () => {
  assert.equal(contact.mailConfig({}), null);
  assert.equal(contact.mailConfig({ RESEND_API_KEY: "k", CONTACT_FROM: "Shop <a@b.gr>" }), null);
  assert.deepEqual(contact.mailConfig({ RESEND_API_KEY: "k", CONTACT_FROM: "Shop <a@b.gr>", CONTACT_TO: "one@b.gr, two@b.gr" }), { apiKey: "k", from: "Shop <a@b.gr>", to: ["one@b.gr", "two@b.gr"] });
});

test("the hidden website field marks a bot: accepted, not sent", () => {
  assert.deepEqual(contact.parseForm({ type: "newsletter", email: "a@b.gr", website: "spam.example" }), { ok: true, spam: true });
});

test("bad email and missing fields are answered with codes", () => {
  assert.deepEqual(contact.parseForm({ type: "newsletter", email: "nope" }), { ok: false, error: "invalid_email" });
  assert.deepEqual(contact.parseForm({ type: "contact", email: "a@b.gr", name: "", message: "hi" }), { ok: false, error: "missing_fields" });
  assert.deepEqual(contact.parseForm(null), { ok: false, error: "invalid_email" });
});

test("a contact message escapes what the visitor typed and replies to them", () => {
  const parsed = contact.parseForm({ type: "contact", email: "a@b.gr", name: "<b>Maria</b>", message: "Hello & bye", subject: "Delivery" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.replyTo, "a@b.gr");
  assert.match(parsed.message.subject, /Delivery/);
  assert.match(parsed.message.html, /&lt;b&gt;Maria&lt;\/b&gt;/);
  assert.match(parsed.message.html, /Hello &amp; bye/);
  assert.doesNotMatch(parsed.message.html, /<b>Maria/);
});

test("sending posts to Resend with the configured sender and inboxes, and throws on failure", async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, init }; return new Response("{}", { status: 200 }); };
  const config = { apiKey: "re_test", from: "Shop <a@b.gr>", to: ["one@b.gr"] };
  const { message } = contact.parseForm({ type: "newsletter", email: "fan@b.gr" });
  await contact.sendForm(message, config, ok);
  assert.equal(sent.url, "https://api.resend.com/emails");
  assert.equal(sent.init.headers.Authorization, "Bearer re_test");
  const body = JSON.parse(sent.init.body);
  assert.deepEqual([body.from, body.to], ["Shop <a@b.gr>", ["one@b.gr"]]);
  assert.match(body.text, /fan@b\.gr/);
  await assert.rejects(contact.sendForm(message, config, async () => new Response("bad", { status: 422 })), /Resend 422/);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --test scripts/shopify/contact.test.mjs`
Expected: FAIL, cannot find `contact.ts`.

- [ ] **Step 3: Write `src/lib/shopify/contact.ts`**

```ts
/**
 * The site's contact form and newsletter sign-up, emailed to the owner through
 * Resend. Server-only: never import this from a client component.
 * Nothing is typed in: the key, the sender and the inboxes come from env vars.
 * Without them the form answers "not_configured" instead of pretending to send.
 * The newsletter goes to the inbox because the Storefront API has no sign-up
 * without a customer password.
 */
export type FormError = "invalid_json" | "invalid_email" | "missing_fields" | "not_configured" | "send_failed";
export interface MailConfig { apiKey: string; from: string; to: string[] }
export interface FormMessage { subject: string; html: string; text: string; replyTo?: string }
export type ParsedForm = { ok: true; message: FormMessage } | { ok: true; spam: true } | { ok: false; error: FormError };

export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const to = (env.CONTACT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.CONTACT_FROM || !to.length) return null;
  return { apiKey: env.RESEND_API_KEY, from: env.CONTACT_FROM, to };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function table(rows: [string, string][]): string {
  const cells = rows
    .map(([label, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top"><strong>${escapeHtml(label)}</strong></td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">${cells}</table>`;
}

export function parseForm(input: unknown): ParsedForm {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (str(body.website, 200)) return { ok: true, spam: true };
  const email = str(body.email, 254);
  if (!isEmail(email)) return { ok: false, error: "invalid_email" };

  if (body.type === "newsletter") {
    return { ok: true, message: { subject: `Newsletter sign-up: ${email}`, html: `<p style="font-family:Arial,sans-serif">New newsletter sign-up from the site.</p>${table([["Email", email]])}`, text: `New newsletter sign-up from the site.\nEmail: ${email}` } };
  }
  const name = str(body.name, 200);
  const message = str(body.message, 5000);
  if (!name || !message) return { ok: false, error: "missing_fields" };
  const subject = str(body.subject, 200);
  const rows: [string, string][] = [["Subject", subject || "-"], ["Name", name], ["Email", email], ["Phone", str(body.phone, 50) || "-"], ["Message", message]];
  return {
    ok: true,
    message: {
      subject: `Message from the site${subject ? `: ${subject}` : ""} (${name})`,
      html: `<p style="font-family:Arial,sans-serif">New message from the contact form. Reply to this email to answer the customer.</p>${table(rows)}`,
      text: rows.map(([l, v]) => `${l}: ${v}`).join("\n"),
      replyTo: email,
    },
  };
}

export async function sendForm(message: FormMessage, config: MailConfig, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.from, to: config.to, subject: message.subject, html: message.html, text: message.text, ...(message.replyTo && { reply_to: message.replyTo }) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
```

- [ ] **Step 4: Write `src/app/api/contact/route.ts`**

```ts
import { NextResponse } from "next/server";
import { mailConfig, parseForm, sendForm } from "@/lib/shopify/contact";

/**
 * The contact form and newsletter sign-up. Answers error codes, not sentences:
 * the frontend shows them in the shop's language.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseForm(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if ("spam" in parsed) return NextResponse.json({ ok: true });
  const config = mailConfig();
  if (!config) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  try {
    await sendForm(parsed.message, config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[contact] send failed", error);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }
}
```

In `scripts/frontend/kit.mjs`, add `"contact"` to `ROUTES`.

- [ ] **Step 5: Run all tests and the type check**

Run: `pnpm test:scripts && npx tsc --noEmit`
Expected: PASS. If `kit.test.mjs` or `install.test.mjs` pins the route list or file count, add the contact route there.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shopify/contact.ts src/app/api/contact scripts/shopify/contact.test.mjs scripts/frontend
git commit -m "feat(kit): contact form and newsletter sign-up emailed to the owner, configured only by env vars"
```

---

### Task 6: Link previews from Shopify's own words and photos

**Files:**
- Create: `src/lib/shopify/seo.ts`, `scripts/shopify/seo.test.mjs`
- Modify: `src/lib/shopify/index.ts` (`export * from "./seo";`)

**Interfaces:**
- Produces:
  - `shareImageUrl(url: string, width = 1200): string`
  - `plainText(html: string | null | undefined, max = 160): string`
  - `productMetadata(product: Pick<Product, "title" | "description" | "featuredImage" | "seo">, { path, shopName }: { path: string; shopName: string }): Metadata`
  - `collectionMetadata(collection: Pick<Collection, "title" | "description" | "image" | "seo">, { path, shopName }): Metadata`

- [ ] **Step 1: Write the failing test**

`scripts/shopify/seo.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const seo = await loadSdk("seo");

test("share images come from Shopify's CDN as JPEG at preview size", () => {
  assert.equal(seo.shareImageUrl("https://cdn.shopify.com/s/files/a.webp?v=1"), "https://cdn.shopify.com/s/files/a.webp?v=1&width=1200&format=jpg");
  assert.equal(seo.shareImageUrl("https://other.example/a.jpg"), "https://other.example/a.jpg");
});

test("descriptions lose their markup and stop at a word", () => {
  assert.equal(seo.plainText("<p>Soft &amp; <b>deep</b> seats</p>"), "Soft & deep seats");
  assert.equal(seo.plainText("one two three four", 9), "one two…");
  assert.equal(seo.plainText(null), "");
});

test("product metadata uses Shopify's SEO fields first, then the product's own", () => {
  const meta = seo.productMetadata(
    { title: "Milano", description: "A deep three-seat sofa.", featuredImage: { url: "https://cdn.shopify.com/m.jpg", altText: "Milano in grey", width: 2000, height: 1500 }, seo: { title: null, description: null } },
    { path: "/products/milano", shopName: "Shop" }
  );
  assert.equal(meta.title, "Milano | Shop");
  assert.equal(meta.description, "A deep three-seat sofa.");
  assert.equal(meta.alternates.canonical, "/products/milano");
  assert.deepEqual(meta.openGraph.images, [{ url: "https://cdn.shopify.com/m.jpg?width=1200&format=jpg", alt: "Milano in grey" }]);
  assert.equal(meta.twitter.card, "summary_large_image");
  const own = seo.productMetadata({ title: "Milano", description: "", featuredImage: null, seo: { title: "Milano sofa", description: "Buy it" } }, { path: "/p", shopName: "Shop" });
  assert.equal(own.title, "Milano sofa | Shop");
  assert.equal(own.openGraph.images, undefined);
  assert.equal(own.twitter.card, "summary");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/shopify/seo.test.mjs`
Expected: FAIL, cannot find `seo.ts`.

- [ ] **Step 3: Write `src/lib/shopify/seo.ts`**

```ts
/**
 * Page metadata and link previews from Shopify's own words and photos, so a
 * shared link shows the product, never a typed-in slogan. Set `metadataBase`
 * from SITE_URL in the root layout: canonical paths resolve against it.
 */
import type { Metadata } from "next";
import type { Collection, Product, ShopifyImage } from "./types";

/** Preview renderers often cannot decode WebP: ask Shopify's CDN for JPEG at preview size. */
export function shareImageUrl(url: string, width = 1200): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "cdn.shopify.com") return url;
    u.searchParams.set("width", String(width));
    u.searchParams.set("format", "jpg");
    return u.toString();
  } catch {
    return url;
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function plainText(html: string | null | undefined, max = 160): string {
  const flat = (html ?? "").replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function build(title: string, description: string, image: ShopifyImage | null | undefined, path: string, shopName: string): Metadata {
  const images = image ? [{ url: shareImageUrl(image.url), alt: image.altText ?? title }] : undefined;
  const full = `${title} | ${shopName}`;
  return {
    title: full,
    description,
    alternates: { canonical: path },
    openGraph: { title: full, description, url: path, siteName: shopName, type: "website", ...(images && { images }) },
    twitter: { card: images ? "summary_large_image" : "summary", title: full, description },
  };
}

export function productMetadata(product: Pick<Product, "title" | "description" | "featuredImage" | "seo">, { path, shopName }: { path: string; shopName: string }): Metadata {
  return build(product.seo?.title || product.title, product.seo?.description || plainText(product.description), product.featuredImage, path, shopName);
}

export function collectionMetadata(collection: Pick<Collection, "title" | "description" | "image" | "seo">, { path, shopName }: { path: string; shopName: string }): Metadata {
  return build(collection.seo?.title || collection.title, collection.seo?.description || plainText(collection.description), collection.image, path, shopName);
}
```

Note: the test's expected `openGraph.images` has no `width`/`height`, matching this code: the CDN resizes, so the original size would be wrong.

- [ ] **Step 4: Run all tests and the type check**

Run: `pnpm test:scripts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopify/seo.ts src/lib/shopify/index.ts scripts/shopify/seo.test.mjs
git commit -m "feat(kit): link previews and page metadata from Shopify's SEO fields and product photos"
```

---

### Task 7: NOTIXV deploy files added by kit-install

Every shop deploys like xristos-store: a Docker image built on push to `dev` or `main`, pushed to NOTIXV's Artifact Registry, picked up by Flux, served at `<repo>.landings.notixv.com` until its own domain is pointed.

**Files:**
- Modify: `scripts/frontend/templates.mjs` (`dockerfile(packageManager)`, `DEPLOY_WORKFLOW`)
- Modify: `scripts/frontend/kit.mjs` (`planKitInstall` extras), `scripts/frontend/kit.test.mjs`
- Modify: `next.config.ts` (kit demo: `output: "standalone"`, so the kit itself proves the image builds)

**Interfaces:**
- Produces: `dockerfile(pm: "pnpm" | "npm"): string`, `DEPLOY_WORKFLOW: string`. `planKitInstall(...).extras` gains `Dockerfile` and `.github/workflows/deploy-image.yaml` when the target has neither; `plan.deployNote` is a string telling the agent to set `output: "standalone"` when `next.config.*` lacks it, else null.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/frontend/kit.test.mjs` (follow its existing fixture setup; it already builds targets with `makeFixture`):

```js
test("kit-install adds the NOTIXV deploy files when the repo has none, for its package manager", () => {
  const target = makeFixture({ "package.json": { name: "shop" }, "pnpm-lock.yaml": "", "next.config.ts": "export default {};\n" });
  const plan = planKitInstall({ kitRoot: process.cwd(), target, appRoot: "" });
  const docker = plan.extras.find((e) => e.to === "Dockerfile");
  assert.match(docker.text, /pnpm install --frozen-lockfile/);
  assert.match(docker.text, /COPY --from=build \/app\/\.next\/standalone/);
  assert.match(docker.text, /USER 1000/);
  const workflow = plan.extras.find((e) => e.to === ".github/workflows/deploy-image.yaml");
  assert.match(workflow.text, /IMAGE: \$\{\{ github\.event\.repository\.name \}\}/);
  assert.match(plan.extras.find((e) => e.to === ".dockerignore").text, /^node_modules$/m);
  assert.match(plan.deployNote, /output: "standalone"/);
});

test("npm repos get npm ci; existing deploy files and a standalone config are left alone", () => {
  const npm = makeFixture({ "package.json": { name: "shop" }, "package-lock.json": "{}" });
  assert.match(planKitInstall({ kitRoot: process.cwd(), target: npm, appRoot: "" }).extras.find((e) => e.to === "Dockerfile").text, /npm ci/);
  const own = makeFixture({ "package.json": { name: "shop" }, Dockerfile: "FROM x\n", ".github/workflows/deploy-image.yaml": "x", "next.config.ts": 'export default { output: "standalone" };\n' });
  const plan = planKitInstall({ kitRoot: process.cwd(), target: own, appRoot: "" });
  assert.equal(plan.extras.some((e) => e.to === "Dockerfile" || e.to.startsWith(".github/")), false);
  assert.equal(plan.deployNote, null);
});
```

(Import `makeFixture` from `../test-support/fixture.mjs` if the file does not already.)

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/frontend/kit.test.mjs`
Expected: FAIL, no `Dockerfile` extra.

- [ ] **Step 3: Add the templates to `templates.mjs`**

```js
/** NOTIXV's container image: the standalone Next server, built only if tests, lint and build pass. */
export function dockerfile(pm) {
  const install = pm === "pnpm"
    ? "COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./\nRUN corepack enable && pnpm install --frozen-lockfile"
    : "COPY package*.json ./\nRUN npm ci --no-audit --fund=false";
  const run = pm === "pnpm" ? "pnpm" : "npm run";
  return `# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

${install}

COPY . .
# NEXT_PUBLIC_* is inlined into the browser bundle at build time, so the origin
# the site is served from has to be known here.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# Publish only an image that passes the kit's tests and lint.
RUN ${run} test:scripts && ${run} lint && ${run} build

# --- runtime -----------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \\
    PORT=3000 \\
    HOSTNAME=0.0.0.0 \\
    NEXT_TELEMETRY_DISABLED=1

ARG GIT_COMMIT
LABEL org.opencontainers.image.revision=$GIT_COMMIT

# output: "standalone" emits a server with only the modules it traced; static/
# and public/ are the two things it does not copy itself.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# The uid, not \`node\`: the chart sets runAsNonRoot and kubelet cannot verify a
# named user, so a non-numeric USER fails with CreateContainerConfigError.
USER 1000
EXPOSE 3000

CMD ["node", "server.js"]
`;
}
```

and, so `COPY . .` never copies the host's `node_modules`, build output or env files over the image's:

```js
export const DOCKERIGNORE = `node_modules
.next
.git
.github
.vercel
*.log
.env
.env.*
test-results
playwright-report
frontend-audit.json
`;
```

and `export const DEPLOY_WORKFLOW = \`...\`` holding the old `.github/workflows/deploy-image.yaml` verbatim (read it from `/tmp/claude-1000/-home-zew0z-Projects-shopify-headless-nextjs/c5c46226-2104-4be8-b4f5-106563acdc31/scratchpad/xristos-store/.github/workflows/deploy-image.yaml`, read-only; every `${{ ... }}` must be escaped as `\${{ ... }}` inside the template literal). It is already generic: the image name and the site url come from `github.event.repository.name`.

- [ ] **Step 4: Add them to `planKitInstall` in `kit.mjs`**

Import `{ dockerfile, DOCKERIGNORE, DEPLOY_WORKFLOW }` alongside the error page templates. Before `return { write, same, ... }`, add:

```js
  // NOTIXV deploy (Docker image -> Artifact Registry -> Flux), only where the repo has its own nothing.
  const pm = existsSync(path.join(target, "package-lock.json")) && !existsSync(path.join(target, "pnpm-lock.yaml")) ? "npm" : "pnpm";
  if (!existsSync(path.join(target, "Dockerfile"))) extras.push({ to: "Dockerfile", text: dockerfile(pm) });
  if (!existsSync(path.join(target, ".dockerignore"))) extras.push({ to: ".dockerignore", text: DOCKERIGNORE });
  if (!existsSync(path.join(target, ".github/workflows/deploy-image.yaml"))) extras.push({ to: ".github/workflows/deploy-image.yaml", text: DEPLOY_WORKFLOW });
  const nextConfig = ["ts", "mjs", "js"].map((ext) => path.join(target, `next.config.${ext}`)).find((f) => existsSync(f));
  const deployNote = nextConfig && /output:\s*["']standalone["']/.test(read(nextConfig)) ? null : 'Set output: "standalone" in next.config: the Dockerfile copies .next/standalone.';
```

and add `deployNote` to the returned object. In `scripts/setup/cli.mjs` `kit-install` case, print `plan.deployNote` with `warn` when it is set (find where the plan's extras are printed and add one line after).

- [ ] **Step 5: The kit demo proves the image builds**

In `next.config.ts` add `output: "standalone",` with the comment `// A self-contained server for the NOTIXV container image (the Dockerfile kit-install adds).`

Run (only if `docker` is available; it is at `/usr/bin/docker` on the user's machine):

```bash
bash -c 'node -e "import(\"./scripts/frontend/templates.mjs\").then(m=>process.stdout.write(m.dockerfile(\"pnpm\")))" > /tmp/kit.Dockerfile && docker build -f /tmp/kit.Dockerfile -t kit-image-check . 2>&1 | tail -20'
```

Expected: the build ends with `naming to docker.io/library/kit-image-check`. If `test:scripts` fails inside the image because a test needs the network, report it with the output and remove `test:scripts` from the `RUN` line only after telling the user. Then `docker image rm kit-image-check`.

- [ ] **Step 6: Run all tests**

Run: `pnpm test:scripts`
Expected: PASS. Install tests that count written files may need the two new extras.

- [ ] **Step 7: Commit**

```bash
git add scripts/frontend next.config.ts scripts/setup/cli.mjs
git commit -m "feat(kit): kit-install adds the NOTIXV Docker image and deploy workflow when the repo has none"
```

---

### Task 8: Tell the agent and the owner (steps, guide, skills)

**Files:**
- Modify: `scripts/setup/steps.mjs`, `scripts/setup/steps.test.mjs` (if it pins ids or counts)
- Modify: `docs/frontend-wiring.md`, `docs/catalogue-import.md`, `docs/shopify-api-gotchas.md`
- Modify: `.claude/skills/shopify-store-setup/SKILL.md`, `.claude/skills/shopify-connect-frontend/SKILL.md`

- [ ] **Step 1: Write the failing test**

Add to `scripts/setup/steps.test.mjs`:

```js
test("the new setup steps exist and name their commands", () => {
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));
  assert.equal(byId["content-types"].automation, "definitions");
  assert.deepEqual(byId["content-types"].needs, ["preflight", "intake"]);
  assert.equal(byId["contact-form"].owner, "human");
  assert.match(byId["dev-app"].instructions, /write_metaobject_definitions, write_metaobjects/);
  assert.match(byId.hosting.instructions, /landings\.notixv\.com/);
});
```

(`STEPS` is already imported there; add the import if not.)

Run: `node --test scripts/setup/steps.test.mjs` — Expected: FAIL.

- [ ] **Step 2: Update `steps.mjs`**

- `dev-app`: add `write_metaobject_definitions, write_metaobjects` to the scope list.
- New step after `catalogue`:

```js
  {
    id: "content-types",
    title: "Create the content types and product fields the site reads",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions:
      "Run pnpm shop-setup definitions --dry-run, show the owner the list, then pnpm shop-setup definitions. It creates the Hero slide type (and Customer review when wantsReviews is true) and a storefront-readable definition for every product field the catalogue sets. The catalogue push runs it too. Tell the owner: hero slides and reviews are entered in the admin under Content > Metaobjects; an empty list hides that part of the site.",
    automation: "definitions",
  },
```

- New step after `email-sender`:

```js
  {
    id: "contact-form",
    title: "Connect the contact form and newsletter to the owner's inbox",
    owner: "human",
    needs: ["hosting"],
    instructions:
      "Only if the site has a contact form or newsletter box. The owner makes a Resend account (resend.com), verifies the shop's domain there, and creates an API key. Set RESEND_API_KEY, CONTACT_FROM (for example Shop <noreply@their-domain>) and CONTACT_TO (their inboxes, comma-separated) in the host's environment, never in the code. Then send one test message through the live form and confirm it arrived. Without these the form answers not_configured, so the frontend must show a plain error for that.",
  },
```

- `hosting`: replace the instructions with: "kit-install added a Dockerfile and .github/workflows/deploy-image.yaml (NOTIXV setup); next.config must have output: \"standalone\". A push to dev or main builds the image and pushes it to NOTIXV's Artifact Registry; Flux deploys it. Ask whoever runs the NOTIXV cluster to add this repo (it serves at <repo>.landings.notixv.com). Set the runtime env there: SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_ACCESS_TOKEN, SHOPIFY_WEBHOOK_SECRET and the contact-form vars (never the Admin token). Then point the main domain's DNS at it and set up an uptime check on /api/health. Give the agent the live URL: it becomes SITE_URL and E2E_SITE_URL."
- `catalogue`: after "read docs/catalogue-import.md first", add "; if the supplier's photos come back FAILED, push again with --rehost=<their host>".
- `frontend-catalogue`: replace "Fields Shopify does not have (ratings, reviews, made-up was-prices, announcement bar, newsletter) are hidden and listed for the owner, never invented." with "Reviews come from getReviews (only when wantsReviews is true) and the hero from getHeroSlides; the contact form and newsletter post to /api/contact; page metadata uses productMetadata and collectionMetadata. Fields Shopify still does not have (made-up was-prices, announcement bar) are hidden and listed for the owner, never invented."
- `seo`: add to its instructions "productMetadata and collectionMetadata (src/lib/shopify/seo.ts) give titles, descriptions, canonical paths and link-preview photos."

Run: `node --test scripts/setup/steps.test.mjs` — Expected: PASS.

- [ ] **Step 3: Update the docs**

- `docs/frontend-wiring.md`, "Things Shopify does not have" table: replace the reviews row with `| Ratings, review counts, reviews | When the owner wants reviews: getReviews({ product }) and reviewSummary(reviews). Otherwise hide. |`; replace the newsletter row with `| Contact form, newsletter sign-up | POST to /api/contact (see the codes below). Show a plain error for not_configured. |`; replace the hero row with `| Hero copy, slogans and pictures | getHeroSlides(): the owner's slides from Content > Metaobjects. Empty: hide the hero. |`. Add a short section "Contact form" listing the request body, the error codes and their status codes from Task 5, and a section "Page metadata" with:

```tsx
// app/products/[handle]/page.tsx
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [product, shop] = await Promise.all([getProduct(handle), getShop()]);
  return product ? productMetadata(product, { path: `/products/${handle}`, shopName: shop.name }) : {};
}
```

- `docs/catalogue-import.md`: replace the "That tooling is a later plan; until then, list the products with failed media for the owner." sentence with "Push again with `--rehost=<host>`: the kit downloads those photos and uploads them to Shopify Files, saving the url map in `data/image-map.json` (commit it). Photos that still fail are listed; give that list to the owner." Add a section "Extra fields and content entries" explaining `definitions`, `metaobjects` and `refs` with one example source return value:

```js
return {
  definitions: { metaobjects: [{ type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field", required: true }, { key: "hex", name: "Hex", type: "single_line_text_field" }] }] },
  metaobjects: [{ type: "color_swatch", handle: "grey", fields: { label: "Grey", hex: "#8a8a8a" } }],
  collections: [],
  products: [{ handle: "milano", title: "Milano", variants: [{ sku: "M-1", price: "899" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }] }],
};
```

  and say: every metafield gets a storefront-readable definition automatically; `refs` name entries by `type/handle`.
- `docs/shopify-api-gotchas.md`, under "Storefront API returns null for every metafield": add "`pnpm shop-setup definitions` creates or opens these; the catalogue push runs it first."

- [ ] **Step 4: Update the skills**

- `.claude/skills/shopify-store-setup/SKILL.md`: where it lists commands, add `definitions` and the `--rehost` flag, one line each.
- `.claude/skills/shopify-connect-frontend/SKILL.md`: where it says reviews/newsletter are hidden, point at `getReviews`, `getHeroSlides`, `/api/contact` and `productMetadata`, and at the frontend-wiring sections above.

- [ ] **Step 5: Run everything**

Run: `pnpm test:scripts && pnpm lint && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/setup docs .claude/skills
git commit -m "docs(kit): setup steps, wiring guide and skills for content types, reviews, hero, contact form, previews and NOTIXV deploy"
```

---

### Task 9: Verification gate

- [ ] **Step 1: Fresh evidence**

Run, and paste the tail of each output into the report:

```bash
pnpm test:scripts
pnpm lint
pnpm build
pnpm shop-setup validate-queries
```

Expected: every command exits 0.

- [ ] **Step 2: Live reads against mock.shop**

Write this throwaway script in the session scratchpad as `live-reads.mjs` (replace `<repo>` with the absolute repo path):

```js
process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "mock.shop";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "mock";
const { loadSdk } = await import("<repo>/scripts/test-support/load-sdk.mjs");
const sdk = await loadSdk();
console.log(JSON.stringify({ hero: await sdk.getHeroSlides(), reviews: await sdk.getReviews(), any: await sdk.getMetaobjects("color_swatch") }));
```

Run it from the repo root: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <scratchpad>/live-reads.mjs`. If the SDK's config rejects these mock.shop values, use whatever `sdk-live.test.mjs` sets for mock.shop. Expected: `{"hero":[],"reviews":[],"any":[]}` (mock.shop has no entries; the query is accepted).

- [ ] **Step 3: kit-install dry run on a clean throwaway frontend**

Make a fixture repo in the scratchpad (package.json with next, an `app/page.tsx`, a `pnpm-lock.yaml`) and run `pnpm shop-setup kit-install <that path> --dry-run`. Expected: the list includes `app/api/contact/route.ts`, `lib/shopify/contact.ts`, `lib/shopify/seo.ts`, `lib/shopify/metaobjects.ts`, `Dockerfile`, `.github/workflows/deploy-image.yaml`, and the standalone warning.

- [ ] **Step 4: Report honestly**

Say plainly what ran and passed, and list as UNVERIFIED (needs a development store): definition and entry writes, the metafield definition scope, draft entries being hidden, photo re-upload end to end, a real email through Resend, and the image deploying through Flux.

- [ ] **Step 5: Push**

```bash
git push origin main
```

(Only with the user's go-ahead in chat for this session's work.)

## Self-review notes

- Spec coverage: product fields and content types (Tasks 1, 2), photo re-upload (3), reviews and hero picks (4), contact form and newsletter (5), link-preview images (6), automatic deploy (7), docs and steps (8). Shop details, trust sections, the filter setup step and the old-kit upgrade path are the audit's next items, not this plan.
- Hero picks moved from product metafields (old kit) to a Hero slide content type: one query instead of reading the whole catalogue, and it can point at a collection link as well as a product.
- `Number(null)` is 0, so `toHeroSlide` checks the raw rank is present before trusting `Number.isInteger`.

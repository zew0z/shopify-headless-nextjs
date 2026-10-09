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

const swatchType = { type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field", required: true }] };

test("a declared reference field takes its target type from the products' refs", () => {
  const catalog = {
    definitions: { metaobjects: [swatchType], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference" }] },
    products: [product([{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }])],
  };
  const { metafields, problems } = wantedDefinitions(catalog, {});
  assert.deepEqual(problems, []);
  assert.equal(metafields[0].refType, "color_swatch");
});

test("a declared refType that differs from the refs is a problem", () => {
  const catalog = {
    definitions: { metaobjects: [swatchType], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refType: "hero_slide" }] },
    products: [product([{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }])],
  };
  assert.match(wantedDefinitions(catalog, {}).problems.join("\n"), /custom\.color is declared as hero_slide but its refs point at color_swatch/);
});

test("a declared reference field with neither refType nor refs is a problem", () => {
  const catalog = { definitions: { metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference" }] }, products: [] };
  assert.match(wantedDefinitions(catalog, {}).problems.join("\n"), /custom\.color is a reference field: give it refType or refs/);
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
    metaobjects: [{ id: "gid://mo/1", type: "hero_slide", access: { storefront: "PUBLIC_READ" }, capabilities: { publishable: { enabled: true } }, fieldDefinitions: [{ key: "title", type: { name: "single_line_text_field" } }] }],
    metafields: [
      { id: "gid://mf/1", namespace: "custom", key: "frame", ownerType: "PRODUCT", type: { name: "single_line_text_field" }, access: { storefront: "NONE" } },
      { id: "gid://mf/2", namespace: "custom", key: "space", ownerType: "PRODUCT", type: { name: "number_integer" }, access: { storefront: "PUBLIC_READ" } },
    ],
  };
  const plan = planDefinitions(wanted, existing);
  assert.deepEqual(plan.createTypes.map((d) => d.type), ["material"]);
  assert.deepEqual(plan.addFields, [{ id: "gid://mo/1", type: "hero_slide", fields: [{ key: "rank", name: "Order", type: "number_integer" }] }]);
  assert.deepEqual(plan.openTypes, []);
  assert.deepEqual(plan.createFields.map((d) => d.key), ["seats"]);
  assert.deepEqual(plan.openAccess.map((d) => d.key), ["frame"]);
  assert.match(plan.problems[0], /custom\.space is number_integer in Shopify, the catalogue wants single_line_text_field/);
});

test("the plan opens an existing type the storefront cannot read or that is not publishable", () => {
  const def = (type) => ({ type, name: type, displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field" }] });
  const wanted = { metaobjects: [def("closed"), def("draftonly"), def("open")], metafields: [] };
  const fields = [{ key: "label", type: { name: "single_line_text_field" } }];
  const existing = {
    metaobjects: [
      { id: "gid://mo/1", type: "closed", access: { storefront: "NONE" }, capabilities: { publishable: { enabled: true } }, fieldDefinitions: fields },
      { id: "gid://mo/2", type: "draftonly", access: { storefront: "PUBLIC_READ" }, capabilities: { publishable: { enabled: false } }, fieldDefinitions: fields },
      { id: "gid://mo/3", type: "open", access: { storefront: "PUBLIC_READ" }, capabilities: { publishable: { enabled: true } }, fieldDefinitions: fields },
    ],
    metafields: [],
  };
  const plan = planDefinitions(wanted, existing);
  assert.deepEqual(plan.openTypes.map((t) => [t.id, t.type]), [["gid://mo/1", "closed"], ["gid://mo/2", "draftonly"]]);
});

// --- push, against a fake Admin API ---------------------------------------
let calls;
let existingTypes;
beforeEach(() => {
  existingTypes = null;
  process.env.SHOPIFY_STORE_DOMAIN = "defs-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_defstest";
  calls = [];
  const reply = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  let created = false;
  mock.method(globalThis, "fetch", async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (/metaobjectDefinitions\(/.test(query)) return reply({ metaobjectDefinitions: { nodes: existingTypes ?? (created ? [{ id: "gid://mo/9", type: "color_swatch", fieldDefinitions: [] }] : []) } });
    if (/metafieldDefinitions\(/.test(query)) return reply({ metafieldDefinitions: { nodes: [] } });
    if (/metaobjectDefinitionCreate/.test(query)) { created = true; return reply({ metaobjectDefinitionCreate: { metaobjectDefinition: { id: "gid://mo/9", type: variables.definition.type }, userErrors: [] } }); }
    if (/metaobjectDefinitionUpdate/.test(query)) return reply({ metaobjectDefinitionUpdate: { metaobjectDefinition: { id: variables.id }, userErrors: [] } });
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

test("push opens an existing type for the storefront and counts it once", async () => {
  existingTypes = [{ id: "gid://mo/5", type: "hero_slide", access: { storefront: "NONE" }, capabilities: { publishable: { enabled: false } }, fieldDefinitions: [{ key: "title", type: { name: "single_line_text_field" } }, { key: "rank", type: { name: "number_integer" } }] }];
  const wanted = {
    metaobjects: [{ type: "hero_slide", name: "Hero slide", displayNameKey: "title", fieldDefinitions: [{ key: "title", name: "Title", type: "single_line_text_field" }, { key: "rank", name: "Order", type: "number_integer" }] }],
    metafields: [],
  };
  const lines = [];
  await pushDefinitions(wanted, { log: (l) => lines.push(l) });
  const update = calls.find((c) => /metaobjectDefinitionUpdate/.test(c.query));
  assert.equal(update.variables.id, "gid://mo/5");
  assert.deepEqual(update.variables.definition, { access: { storefront: "PUBLIC_READ" }, capabilities: { publishable: { enabled: true } } });
  assert.ok(lines.includes("  ~ type hero_slide: storefront can read it now"));
  assert.ok(lines.includes("  = 0 definition(s) already right"));
});

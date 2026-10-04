import { adminGraphQL } from "../shopify/admin-client.mjs";
import { bad, info, ok } from "../shopify/env.mjs";

const money = (n, currencyCode) => ({ amount: n.toFixed(2), currencyCode });
const round2 = (n) => Math.round(n * 100) / 100;

/** One zone with every configured country, every paid rate, and the free rule. */
export function buildZone(config) {
  const { currency, freeShippingThreshold: threshold } = config;
  const methods = config.shippingRates.map((rate) => {
    const method = {
      name: rate.name,
      active: true,
      rateDefinition: { price: money(rate.price, currency) },
    };
    if (threshold !== null) {
      // Cap paid rates just under the threshold so the paid and free options never both show.
      method.priceConditionsToCreate = [{ operator: "LESS_THAN_OR_EQUAL_TO", criteria: money(round2(threshold - 0.01), currency) }];
    }
    const weight = [];
    if (rate.minWeightKg !== undefined) weight.push({ operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { value: rate.minWeightKg, unit: "KILOGRAMS" } });
    if (rate.maxWeightKg !== undefined) weight.push({ operator: "LESS_THAN_OR_EQUAL_TO", criteria: { value: rate.maxWeightKg, unit: "KILOGRAMS" } });
    if (weight.length) method.weightConditionsToCreate = weight;
    return method;
  });

  if (threshold !== null) {
    methods.push({
      name: "Free shipping",
      active: true,
      rateDefinition: { price: money(0, currency) },
      priceConditionsToCreate: [{ operator: "GREATER_THAN_OR_EQUAL_TO", criteria: money(threshold, currency) }],
    });
  }

  return {
    name: "Storefront shipping",
    countries: config.shippingCountries.map((code) => ({ code, includeAllProvinces: true })),
    methodDefinitionsToCreate: methods,
  };
}

export function findCountryCollisions(profile, countries) {
  const found = [];
  for (const group of profile.profileLocationGroups ?? []) {
    for (const { zone } of group.locationGroupZones?.nodes ?? []) {
      for (const country of zone.countries ?? []) {
        const code = country.code?.countryCode;
        if (countries.includes(code)) found.push({ zone: zone.name, country: code });
      }
    }
  }
  return found;
}

const DISCOVERY = `
  query {
    locations(first: 10) { nodes { id name isActive } }
    deliveryProfiles(first: 10) {
      nodes {
        id name default
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 50) {
            nodes { zone { id name countries { code { countryCode } } } }
          }
        }
      }
    }
  }`;

const UPDATE = `
  mutation($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id name }
      userErrors { field message }
    }
  }`;

/**
 * Adds the zone to the store's default (General) profile.
 * Refuses on a country collision rather than duplicate or overwrite: the person
 * decides what happens to a zone they or Shopify already created.
 * UNVERIFIED until run against a development store (Step 1 and Task 8).
 */
export async function applyShipping({ config, dryRun = false, locationId } = {}) {
  const data = await adminGraphQL(DISCOVERY);
  const active = data.locations.nodes.filter((l) => l.isActive);
  const location = locationId ? active.find((l) => l.id === locationId) : active.length === 1 ? active[0] : null;
  if (!location) {
    bad(`pick a location with --location=<id>: ${active.map((l) => `${l.name} ${l.id}`).join(", ") || "none active"}`);
    process.exit(1);
  }

  const profile = data.deliveryProfiles.nodes.find((p) => p.default);
  if (!profile) {
    bad("no default delivery profile found");
    process.exit(1);
  }

  const collisions = findCountryCollisions(profile, config.shippingCountries);
  if (collisions.length) {
    bad("these countries already have a shipping zone, not touching them:");
    for (const c of collisions) info(`${c.country} in zone "${c.zone}"`);
    info("Edit or delete those zones in Settings > Shipping and delivery, then re-run.");
    process.exit(2);
  }

  const zone = buildZone(config);
  const group = profile.profileLocationGroups[0]?.locationGroup;
  const input = group
    ? { locationGroupsToUpdate: [{ id: group.id, zonesToCreate: [zone] }] }
    : { locationGroupsToCreate: [{ locations: [location.id], zonesToCreate: [zone] }] };

  info(`profile ${profile.name} (${profile.id}), location ${location.name}`);
  info(JSON.stringify(zone, null, 2));
  if (dryRun) {
    ok("dry run, nothing written");
    return;
  }
  await adminGraphQL(UPDATE, { id: profile.id, profile: input });
  ok(`shipping zone created with ${zone.methodDefinitionsToCreate.length} rate(s)`);
}

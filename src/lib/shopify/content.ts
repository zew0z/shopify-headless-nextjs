/**
 * The shop's name, menus, legal policies and info pages, read from Shopify so
 * nothing in the header, footer or legal pages is typed into the frontend.
 * Shopify sends no webhooks for these, so they are cached for an hour.
 */
import { shopifyFetch, requireShopify, dataOrThrow } from "./client";
import { shopDetailsQuery, menuQuery, policiesQuery, pageQuery } from "./queries";
import type { ShopDetails, Menu, ShopPolicy, ContentPage } from "./types";

const CONTENT = { cache: "force-cache" as RequestCache, tags: ["content"], revalidate: 3600 };

async function read<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  requireShopify();
  const res = await shopifyFetch<T>({ query, variables, ...CONTENT });
  return dataOrThrow(res.body.data);
}

export async function getShop(): Promise<ShopDetails> {
  return (await read<{ shop: ShopDetails }>(shopDetailsQuery)).shop;
}

/** A menu by handle. Shopify's default menus are "main-menu" and "footer". */
export async function getMenu(handle: string): Promise<Menu | null> {
  return (await read<{ menu: Menu | null }>(menuQuery, { handle })).menu;
}

const POLICY_KEYS = ["privacyPolicy", "refundPolicy", "shippingPolicy", "termsOfService"] as const;

/** The legal policies the shop has filled in. */
export async function getPolicies(): Promise<ShopPolicy[]> {
  const { shop } = await read<{ shop: Record<(typeof POLICY_KEYS)[number], ShopPolicy | null> }>(policiesQuery);
  return POLICY_KEYS.map((k) => shop[k]).filter((p): p is ShopPolicy => p !== null);
}

export async function getPolicy(handle: string): Promise<ShopPolicy | null> {
  return (await getPolicies()).find((p) => p.handle === handle) ?? null;
}

/** An info page (About, FAQ...) made in Shopify under Online Store > Pages. */
export async function getPage(handle: string): Promise<ContentPage | null> {
  return (await read<{ page: ContentPage | null }>(pageQuery, { handle })).page;
}

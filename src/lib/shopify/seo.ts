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

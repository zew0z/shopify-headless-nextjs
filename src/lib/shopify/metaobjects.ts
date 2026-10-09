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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rank only orders the list
    .map(({ rank: _rank, ...slide }) => slide);
}

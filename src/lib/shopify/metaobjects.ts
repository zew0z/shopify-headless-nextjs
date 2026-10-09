/**
 * Pure mappers for content entries (Content > Metaobjects): reviews, hero
 * slides, shop details and FAQ the owner types into the Shopify admin.
 * Browser-safe: no fetch here. Anything incomplete is dropped, never filled in
 * with made-up words or pictures.
 */
import type { EntryProduct, FaqItem, HeroSlide, LinkedEntry, MetaobjectEntry, MetaobjectField, Review, ShopifyImage, StoreProfile } from "./types";

interface RawField {
  key: string;
  value: string | null;
  reference: { __typename: string; image?: ShopifyImage; handle?: string; title?: string; featuredImage?: ShopifyImage | null } | null;
  references: { nodes: Array<{ __typename: string; handle?: string; fields?: Array<{ key: string; value: string | null }> }> } | null;
}
export interface RawEntry { handle: string; updatedAt: string; fields: RawField[] }

const text = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

export type RawLinked = { __typename: string; handle?: string; fields?: Array<{ key: string; value: string | null }> };
const toLinkedEntry = (n: RawLinked): LinkedEntry => ({ handle: n.handle!, fields: Object.fromEntries((n.fields ?? []).map((x) => [x.key, text(x.value)])) });

/** The entries a reference field points at: one for a single reference, all for a list. Other kinds of target are dropped. */
export function toLinkedEntries(reference: RawLinked | null | undefined, references: { nodes: RawLinked[] } | null | undefined): LinkedEntry[] {
  const nodes = references ? references.nodes : reference ? [reference] : [];
  return nodes.filter((n) => n.__typename === "Metaobject").map(toLinkedEntry);
}

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
        .map(toLinkedEntry),
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

/** A whole number field's value, or null when blank or not a whole number. */
const integer = (e: MetaobjectEntry, key: string): number | null => {
  const v = value(e, key);
  return v !== null && Number.isInteger(Number(v)) ? Number(v) : null;
};

/** A list field's value is a JSON array of strings; anything else is an empty list. */
const list = (v: string | null): string[] => {
  if (!v) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
  } catch {
    return [];
  }
};

/** The shop details entry. Null without a business name, so a half-made entry hides everything rather than showing scraps. */
export function toStoreProfile(e: MetaobjectEntry): StoreProfile | null {
  const legalName = value(e, "legal_name");
  if (!legalName) return null;
  const iban = value(e, "bank_iban");
  return {
    legalName,
    address: value(e, "address"),
    phones: list(value(e, "phones")),
    email: value(e, "email"),
    openingHours: list(value(e, "opening_hours")),
    mapUrl: value(e, "map_url"),
    foundedYear: integer(e, "founded_year"),
    deliveryNote: value(e, "delivery_note"),
    priceNote: value(e, "price_note"),
    bank: iban ? { beneficiary: value(e, "bank_beneficiary"), iban } : null,
  };
}

/** The owner's order (1 first); items without an order go last, by handle. Items missing a question or an answer are dropped. */
export function toFaqItems(entries: MetaobjectEntry[]): FaqItem[] {
  return entries
    .map((e) => ({ handle: e.handle, question: value(e, "question"), answer: value(e, "answer"), rank: integer(e, "rank") }))
    .filter((f): f is FaqItem & { rank: number | null } => f.question !== null && f.answer !== null)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.handle.localeCompare(b.handle))
    .map(({ handle, question, answer }) => ({ handle, question, answer }));
}

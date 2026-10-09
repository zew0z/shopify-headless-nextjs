import { createStorefront, type StorefrontOptions } from "./client";
import { METAOBJECTS_QUERY } from "./queries";
import { toEntry, toStoreProfile, toFaqItems, type RawEntry } from "./kit-metaobjects";

/** Same owner-authored types as the Next kit. Cache the rendered public content with Astro's content tag. */
export function createShopifyContent(options: StorefrontOptions) {
  const storefront = createStorefront(options);
  const getMetaobjects = async (type: string, first: number, lang = options.defaultLanguage ?? "en") => {
    const data = await storefront<{ metaobjects: { nodes: RawEntry[] } }>({ query: METAOBJECTS_QUERY, lang, variables: { type, first } });
    return data.metaobjects.nodes.map(toEntry);
  };
  return {
    getStoreProfile: async (lang?: string) => {
      const [entry] = await getMetaobjects("store_profile", 1, lang);
      return entry ? toStoreProfile(entry) : null;
    },
    getFaq: async (lang?: string) => toFaqItems(await getMetaobjects("faq_item", 100, lang)),
  };
}

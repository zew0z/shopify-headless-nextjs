import { MetadataRoute } from "next";
import { getProducts, getCollections } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

  const [products, collections] = await Promise.all([
    getProducts({ limit: 100 }),
    getCollections({ limit: 50 }),
  ]);

  const productRoutes = products.map((product) => ({
    url: `${baseUrl}/products/${product.handle}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const collectionRoutes = collections.map((col) => ({
    url: `${baseUrl}/collections/${col.handle}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "always" as const,
      priority: 1.0,
    },
    ...productRoutes,
    ...collectionRoutes,
  ];
}

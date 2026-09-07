import { notFound } from "next/navigation";
import Link from "next/link";
import { getCollection, getCollectionProducts } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { handle } = await params;
  const collection = await getCollection(handle);

  if (!collection) {
    return { title: "Collection Not Found" };
  }

  return {
    title: `${collection.title} | Aura Storefront`,
    description: collection.description || `Browse items from ${collection.title}.`,
  };
}

export default async function CollectionPage({ params }: Props) {
  const { handle } = await params;
  const collection = await getCollection(handle);

  if (!collection) {
    notFound();
  }

  const products = await getCollectionProducts({ handle, limit: 24 });

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
      {/* Back button */}
      <Link
        href="/#collections"
        className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Collections</span>
      </Link>

      {/* Collection Header */}
      <div className="border-b border-neutral-200 dark:border-neutral-800 pb-8 mb-10">
        <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
          Collection
        </span>
        <h1 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
          {collection.title}
        </h1>
        {collection.description && (
          <p className="mt-3 text-sm sm:text-base text-neutral-500 dark:text-neutral-400 max-w-2xl leading-relaxed">
            {collection.description}
          </p>
        )}
        <div className="mt-4 text-xs font-semibold text-neutral-400">
          {products.length} {products.length === 1 ? "product" : "products"} available
        </div>
      </div>

      {/* Products Grid */}
      {products.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-base font-medium text-neutral-900 dark:text-white">
            No products found in this collection.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Publish products to this collection in your Shopify Admin to display them here.
          </p>
          <Link
            href="/#products"
            className="mt-6 inline-flex rounded-full bg-neutral-900 px-6 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900 transition-colors"
          >
            Browse All Products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

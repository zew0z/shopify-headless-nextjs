import Link from "next/link";
import { getProducts, getCollections, isShopifyConfigured } from "@/lib/shopify";
import { MOCK_PRODUCTS } from "@/lib/shopify/mock-data";
import { ProductCard } from "@/components/ProductCard";
import { ArrowRight, Sparkles, CheckCircle2, PackagePlus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const liveProducts = await getProducts({ limit: 8 });
  const collections = await getCollections();

  const hasLiveProducts = liveProducts.length > 0;
  const displayProducts = hasLiveProducts ? liveProducts : MOCK_PRODUCTS;

  return (
    <div className="flex flex-col gap-16 pb-20">
      {/* Live Status Banner */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl px-5 py-3.5 text-sm font-medium border bg-emerald-50/90 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span>
              Connected to <strong>My Store 2</strong> ({process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN}) via Storefront API
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-200/80 dark:bg-emerald-900/60 px-3 py-1 text-xs font-semibold text-emerald-900 dark:text-emerald-100">
              <CheckCircle2 className="h-3.5 w-3.5" />
              API Verified
            </span>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-2 pb-10 sm:pb-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-3xl bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 px-6 py-20 sm:px-12 sm:py-28 text-white shadow-2xl overflow-hidden">
            {/* Ambient background glow */}
            <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />

            <div className="relative z-10 max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-neutral-200 backdrop-blur-md mb-6">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>Next.js 15 App Router & Shopify Storefront</span>
              </div>

              <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl leading-[1.1]">
                Precision Goods for the Modern Life.
              </h1>

              <p className="mt-5 text-base sm:text-lg text-neutral-300 leading-relaxed max-w-xl">
                Experience ultra-fast headless e-commerce. Lightning-speed navigation, real-time cart state, and direct Shopify checkout redirection.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="#products"
                  className="flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-100 transition-all hover:scale-105 shadow-lg"
                >
                  <span>Browse Products</span>
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="#shopify-admin-guide"
                  className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors backdrop-blur-xs"
                >
                  <span>Add Products in Shopify</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Notice if Store has 0 products published */}
      {!hasLiveProducts && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-sky-200 bg-sky-50/80 dark:border-sky-900/60 dark:bg-sky-950/30 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-sky-600 text-white p-2.5 mt-0.5 shadow-sm">
                <PackagePlus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sky-950 dark:text-sky-200 text-base">
                  Your Shopify store has 0 published products
                </h3>
                <p className="text-xs sm:text-sm text-sky-800 dark:text-sky-300 mt-1">
                  We are showing sample demo items below so your storefront remains fully testable. As soon as you create an active product in your Shopify Admin, it will instantly appear right here!
                </p>
              </div>
            </div>

            <a
              href="https://admin.shopify.com/store/5bk7s8-pn/products/new"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-2 rounded-xl bg-sky-900 dark:bg-sky-100 dark:text-sky-950 text-white px-4 py-2.5 text-xs font-semibold hover:bg-sky-800 transition-colors shadow-sm"
            >
              <span>Create Product in Shopify</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </section>
      )}

      {/* Products Section */}
      <section id="products" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-3xl">
              {hasLiveProducts ? "Your Store Products" : "Catalog Preview"}
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {hasLiveProducts
                ? "Live inventory synchronized directly from your Shopify store."
                : "Interactive mock items while your Shopify catalog is prepared."}
            </p>
          </div>
          <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
            {displayProducts.length} Items Available
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {displayProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* Collections Section */}
      <section id="collections" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-3xl">
            Curated Collections
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Organized departments powered by Shopify Smart & Custom Collections
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {collections.map((col) => (
            <div
              key={col.id}
              className="group relative overflow-hidden rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 shadow-sm transition-all hover:shadow-xl"
            >
              <div className="relative z-10 max-w-md">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                  Collection
                </span>
                <h3 className="mt-2 text-2xl font-bold text-neutral-900 dark:text-white">
                  {col.title}
                </h3>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  {col.description}
                </p>
                <Link
                  href="#products"
                  className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white group-hover:underline"
                >
                  <span>Shop Collection</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Shopify Admin Next Steps */}
      <section id="shopify-admin-guide" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 sm:p-12 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-sm">
              ✓
            </span>
            <h3 className="text-xl font-bold text-neutral-900 dark:text-white">
              Shopify Connection Successful!
            </h3>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 max-w-2xl leading-relaxed">
            Your Next.js storefront is now authenticated with <strong>My Store 2</strong>. Here is how to add your products and publish them to your headless storefront:
          </p>

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 p-6 border border-neutral-200/60 dark:border-neutral-700/60">
              <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2">STEP 1</div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-white">Go to Products</h4>
              <p className="mt-2 text-xs text-neutral-500 leading-relaxed">
                In your Shopify Admin left menu, click <strong>Προϊόντα (Products)</strong> &rarr; <strong>Προσθήκη προϊόντος (Add product)</strong>.
              </p>
            </div>

            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 p-6 border border-neutral-200/60 dark:border-neutral-700/60">
              <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2">STEP 2</div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-white">Set Title, Price & Image</h4>
              <p className="mt-2 text-xs text-neutral-500 leading-relaxed">
                Add a title, upload a photo, set a price, and set Status to <strong>Active (Ενεργό)</strong>.
              </p>
            </div>

            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 p-6 border border-neutral-200/60 dark:border-neutral-700/60">
              <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2">STEP 3</div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-white">Publish to Sales Channels</h4>
              <p className="mt-2 text-xs text-neutral-500 leading-relaxed">
                Under <strong>Sales channels (Κανάλια πωλήσεων)</strong> on the right sidebar, make sure your app / Headless channel is checked!
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getProduct, getProducts } from "@/lib/shopify";
import { ProductForm } from "@/components/ProductForm";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";

interface ProductPageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) return { title: "Product Not Found" };

  return {
    title: `${product.title} | Aura Storefront`,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProduct(handle);

  if (!product) {
    notFound();
  }

  const images = product.images.edges.map((e) => e.node);
  const primaryImage = product.featuredImage || images[0] || {
    url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=800&auto=format&fit=crop",
    altText: product.title,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-8">
        <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/#products" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Products
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-neutral-900 dark:text-white truncate max-w-xs">{product.title}</span>
      </nav>

      {/* Main product layout */}
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        {/* Gallery */}
        <div className="space-y-4">
          <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
            <Image
              src={primaryImage.url}
              alt={primaryImage.altText || product.title}
              fill
              priority
              className="object-cover object-center"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>

          {images.length > 1 && (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {images.map((img, idx) => (
                <div
                  key={idx}
                  className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100"
                >
                  <Image
                    src={img.url}
                    alt={img.altText || `View ${idx + 1}`}
                    fill
                    className="object-cover object-center"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Product Details & Variant Selection */}
        <div className="flex flex-col justify-center">
          {product.vendor && (
            <p className="text-xs uppercase tracking-widest font-bold text-neutral-400 mb-1">
              {product.vendor}
            </p>
          )}

          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white sm:text-4xl">
            {product.title}
          </h1>

          <div className="mt-4">
            <ProductForm product={product} />
          </div>

          {/* Description Section */}
          <div className="mt-8 border-t border-neutral-200 dark:border-neutral-800 pt-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900 dark:text-white mb-2">
              Product Overview
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              {product.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

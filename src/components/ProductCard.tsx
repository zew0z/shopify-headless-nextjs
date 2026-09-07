"use client";

import Link from "next/link";
import Image from "next/image";
import { Product } from "@/lib/shopify/types";
import { useCart } from "@/context/cart-context";
import { Plus } from "lucide-react";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();
  const firstVariant = product.variants.edges[0]?.node;
  const imageUrl =
    product.featuredImage?.url ||
    firstVariant?.image?.url ||
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=800&auto=format&fit=crop";

  const minPrice = parseFloat(product.priceRange.minVariantPrice.amount);
  const comparePrice = product.compareAtPriceRange?.minVariantPrice
    ? parseFloat(product.compareAtPriceRange.minVariantPrice.amount)
    : null;

  const hasDiscount = comparePrice && comparePrice > minPrice;

  const handleQuickAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (firstVariant) {
      await addItem(firstVariant, product, 1);
    }
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-900 transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
      {/* Product Image Container */}
      <Link href={`/products/${product.handle}`} className="relative aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        <Image
          src={imageUrl}
          alt={product.featuredImage?.altText || product.title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover object-center transition-transform duration-500 group-hover:scale-105"
        />

        {hasDiscount && (
          <span className="absolute top-3 left-3 rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow">
            Sale
          </span>
        )}

        {/* Quick Add overlay button */}
        <button
          onClick={handleQuickAdd}
          aria-label="Quick Add to Cart"
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-md backdrop-blur transition-all duration-200 hover:scale-110 hover:bg-neutral-900 hover:text-white dark:bg-neutral-900/90 dark:text-white dark:hover:bg-white dark:hover:text-neutral-900"
        >
          <Plus className="h-5 w-5" />
        </button>
      </Link>

      {/* Product Info */}
      <div className="flex flex-1 flex-col p-5">
        {product.vendor && (
          <p className="text-xs uppercase tracking-wider text-neutral-400 font-medium">
            {product.vendor}
          </p>
        )}
        <h3 className="mt-1 font-semibold text-neutral-900 dark:text-white text-base line-clamp-1">
          <Link href={`/products/${product.handle}`} className="hover:underline">
            {product.title}
          </Link>
        </h3>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
          {product.description}
        </p>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-lg font-bold text-neutral-900 dark:text-white">
            ${minPrice.toFixed(2)}
          </span>
          {hasDiscount && (
            <span className="text-xs text-neutral-400 line-through">
              ${comparePrice?.toFixed(2)}
            </span>
          )}
          <span className="text-xs text-neutral-400">
            {product.priceRange.minVariantPrice.currencyCode}
          </span>
        </div>
      </div>
    </div>
  );
}

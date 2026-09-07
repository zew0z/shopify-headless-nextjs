"use client";

import Link from "next/link";
import { useCart } from "@/context/cart-context";
import { ShoppingBag, Sparkles } from "lucide-react";

export function Header() {
  const { totalQuantity, openCart } = useCart();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-200/80 bg-white/80 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-950/80 transition-colors">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 text-white font-bold text-base shadow-sm group-hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 transition-colors">
            A
          </span>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white leading-none">
              AURA
            </span>
            <span className="text-[10px] tracking-widest uppercase font-semibold text-neutral-400 dark:text-neutral-500">
              Headless
            </span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          <Link href="/" className="hover:text-neutral-950 dark:hover:text-white transition-colors">
            Home
          </Link>
          <Link href="/#products" className="hover:text-neutral-950 dark:hover:text-white transition-colors">
            Catalog
          </Link>
          <Link href="/#collections" className="hover:text-neutral-950 dark:hover:text-white transition-colors">
            Collections
          </Link>
          <Link
            href="/#shopify-admin-guide"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
          >
            <Sparkles className="h-3 w-3" />
            <span>Shopify Sync</span>
          </Link>
        </nav>

        {/* Actions: Cart Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={openCart}
            aria-label="Shopping Cart"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-800 shadow-2xs hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 transition-all hover:scale-105 active:scale-95"
          >
            <ShoppingBag className="h-4 w-4" />
            {totalQuantity > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white ring-2 ring-white dark:bg-white dark:text-neutral-900 dark:ring-neutral-950 animate-in zoom-in duration-150">
                {totalQuantity}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

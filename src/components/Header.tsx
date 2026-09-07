"use client";

import Link from "next/link";
import { ShoppingBag, Search, Sparkles } from "lucide-react";
import { useCart } from "@/context/cart-context";

export function Header() {
  const { openCart, totalQuantity } = useCart();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-200 bg-white/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/80 transition-colors">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-xl text-neutral-900 dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm">
              <Sparkles className="h-4 w-4" />
            </span>
            <span>AURA</span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              All Products
            </Link>
            <Link href="/#collections" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              Collections
            </Link>
            <Link href="/#about" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              About
            </Link>
          </nav>
        </div>

        {/* Right Actions: Search & Cart */}
        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block w-48 lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <input
              type="text"
              placeholder="Search catalog..."
              className="w-full rounded-full border border-neutral-200 bg-neutral-50 py-1.5 pl-9 pr-4 text-xs focus:border-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>

          <button
            onClick={openCart}
            aria-label="Open Cart"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900 transition-colors"
          >
            <ShoppingBag className="h-5 w-5 text-neutral-800 dark:text-neutral-200" />
            {totalQuantity > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-bold text-white dark:bg-white dark:text-neutral-900 shadow">
                {totalQuantity}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

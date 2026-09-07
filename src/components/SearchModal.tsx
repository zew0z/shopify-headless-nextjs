"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Search, X, Loader2, ArrowRight } from "lucide-react";
import { PredictiveSearchResult } from "@/lib/shopify/types";

export function SearchModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PredictiveSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data: PredictiveSearchResult = await res.json();
        setResults(data);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  const hasProducts = results && results.products && results.products.length > 0;
  const hasCollections = results && results.collections && results.collections.length > 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-neutral-900/60 backdrop-blur-xs transition-opacity"
      />

      {/* Modal Dialog */}
      <div className="relative min-h-screen flex items-start justify-center p-4 pt-16 sm:pt-24">
        <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          {/* Search Input Bar */}
          <div className="flex items-center px-4 py-3.5 border-b border-neutral-200 dark:border-neutral-800">
            <Search className="h-5 w-5 text-neutral-400 mr-3 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, collections, tags..."
              className="w-full bg-transparent text-sm sm:text-base text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-hidden"
            />
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400 ml-2" />
            ) : query ? (
              <button
                onClick={() => setQuery("")}
                className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="ml-3 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              ESC
            </button>
          </div>

          {/* Results Area */}
          <div className="max-h-[60vh] overflow-y-auto p-4">
            {!query.trim() && (
              <div className="py-8 text-center text-sm text-neutral-400">
                Type something to search live products from Shopify...
              </div>
            )}

            {query.trim() && !loading && !hasProducts && !hasCollections && (
              <div className="py-8 text-center text-sm text-neutral-500">
                No matching products found for &ldquo;{query}&rdquo;.
              </div>
            )}

            {/* Products Results */}
            {hasProducts && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider px-2 mb-2">
                  Products
                </h4>
                <div className="space-y-1">
                  {results.products.map((p) => {
                    const img =
                      p.featuredImage?.url ||
                      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=200&auto=format&fit=crop";
                    return (
                      <Link
                        key={p.id}
                        href={`/products/${p.handle}`}
                        onClick={onClose}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors group"
                      >
                        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
                          <Image
                            src={img}
                            alt={p.title}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-900 dark:text-white truncate group-hover:text-emerald-600 transition-colors">
                            {p.title}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {p.priceRange.minVariantPrice.currencyCode === "EUR" ? "€" : "$"}
                            {parseFloat(p.priceRange.minVariantPrice.amount).toFixed(2)}
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Collections Results */}
            {hasCollections && (
              <div>
                <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider px-2 mb-2">
                  Collections
                </h4>
                <div className="space-y-1">
                  {results.collections.map((col) => (
                    <Link
                      key={col.id}
                      href={`/collections/${col.handle}`}
                      onClick={onClose}
                      className="flex items-center justify-between p-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm font-medium text-neutral-800 dark:text-neutral-200"
                    >
                      <span>{col.title}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

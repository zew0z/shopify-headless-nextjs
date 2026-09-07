"use client";

import Image from "next/image";
import { useCart } from "@/context/cart-context";
import { X, Minus, Plus, Trash2, ShoppingBag, ArrowRight, Loader2 } from "lucide-react";

export function CartDrawer() {
  const {
    isOpen,
    isLoading,
    closeCart,
    cart,
    totalQuantity,
    subtotal,
    currency,
    updateItemQuantity,
    removeItem,
    checkoutUrl,
  } = useCart();

  if (!isOpen) return null;

  const lines = cart?.lines.edges || [];

  const handleCheckout = () => {
    if (checkoutUrl && checkoutUrl.startsWith("http")) {
      window.location.href = checkoutUrl;
    } else {
      alert("Checkout session is generating, please wait a moment or try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Dimmed backdrop */}
      <div
        onClick={closeCart}
        className="fixed inset-0 bg-neutral-900/60 backdrop-blur-xs transition-opacity duration-300"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-md bg-white dark:bg-neutral-900 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-neutral-900 dark:text-white" />
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
                Your Bag ({totalQuantity})
              </h2>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-neutral-400 ml-2" />}
            </div>
            <button
              onClick={closeCart}
              aria-label="Close cart"
              className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:text-neutral-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {lines.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 mb-4 text-neutral-400">
                  <ShoppingBag className="h-8 w-8" />
                </div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                  Your cart is empty
                </h3>
                <p className="mt-1 text-sm text-neutral-500 max-w-xs">
                  Looks like you haven&apos;t added any items yet. Explore our catalog to find pieces you love.
                </p>
                <button
                  onClick={closeCart}
                  className="mt-6 rounded-full bg-neutral-900 px-6 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 transition-colors"
                >
                  Start Browsing
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {lines.map(({ node: line }) => {
                  const item = line.merchandise;
                  const img =
                    item.product.featuredImage?.url ||
                    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=300&auto=format&fit=crop";

                  return (
                    <li key={line.id} className="py-4 flex gap-4">
                      {/* Thumbnail */}
                      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800">
                        <Image
                          src={img}
                          alt={item.product.title}
                          fill
                          className="object-cover object-center"
                        />
                      </div>

                      {/* Details */}
                      <div className="flex flex-1 flex-col justify-between">
                        <div>
                          <div className="flex justify-between text-sm font-medium text-neutral-900 dark:text-white">
                            <h4 className="line-clamp-1">{item.product.title}</h4>
                            <p className="ml-2 font-semibold">
                              ${parseFloat(line.cost.totalAmount.amount).toFixed(2)}
                            </p>
                          </div>
                          {item.title && item.title !== "Default Title" && (
                            <p className="mt-0.5 text-xs text-neutral-500">{item.title}</p>
                          )}
                        </div>

                        {/* Stepper & Remove */}
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700">
                            <button
                              onClick={() => updateItemQuantity(line.id, line.quantity - 1)}
                              disabled={isLoading}
                              aria-label="Decrease quantity"
                              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-l-lg transition-colors disabled:opacity-50"
                            >
                              <Minus className="h-3 w-3 text-neutral-600 dark:text-neutral-400" />
                            </button>
                            <span className="px-2.5 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                              {line.quantity}
                            </span>
                            <button
                              onClick={() => updateItemQuantity(line.id, line.quantity + 1)}
                              disabled={isLoading}
                              aria-label="Increase quantity"
                              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-r-lg transition-colors disabled:opacity-50"
                            >
                              <Plus className="h-3 w-3 text-neutral-600 dark:text-neutral-400" />
                            </button>
                          </div>

                          <button
                            onClick={() => removeItem(line.id)}
                            disabled={isLoading}
                            aria-label="Remove item"
                            className="text-neutral-400 hover:text-rose-500 transition-colors p-1 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer & Checkout */}
          {lines.length > 0 && (
            <div className="border-t border-neutral-200 dark:border-neutral-800 px-6 py-5 space-y-4 bg-neutral-50/50 dark:bg-neutral-900/50">
              <div className="flex items-center justify-between text-base font-semibold text-neutral-900 dark:text-white">
                <span>Subtotal</span>
                <span>
                  {currency === "EUR" ? "€" : "$"}
                  {parseFloat(subtotal).toFixed(2)} {currency}
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                Taxes and shipping calculated securely on Shopify checkout.
              </p>

              <button
                onClick={handleCheckout}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-3.5 px-4 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.01] disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Syncing with Shopify...</span>
                  </>
                ) : (
                  <>
                    <span>Proceed to Shopify Checkout</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

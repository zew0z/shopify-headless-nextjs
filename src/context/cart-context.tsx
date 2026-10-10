"use client";

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { Cart, ProductVariant, Product } from "@/lib/shopify/types";
import { createCartStore, localCartStorage } from "@/lib/shopify/cart-store";
import { trackAddToCart } from "@/lib/shopify/analytics";

interface CartContextType {
  cart: Cart | null;
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  openCart: () => void;
  closeCart: () => void;
  addItem: (variant: ProductVariant, product: Product, quantity?: number) => Promise<void>;
  updateItemQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeItem: (lineId: string) => Promise<void>;
  totalQuantity: number;
  checkout: () => Promise<void>;
  refreshCart: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);
const CART_ID_KEY = "shopify_cart_id";
const LEGACY_CART_STATE_KEY = "shopify_cart_state";

/** The demo drawer uses the same serialized, warning-aware cart as installed receivers. */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createCartStore({ storage: localCartStorage(CART_ID_KEY), onAdd: trackAddToCart }));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_CART_STATE_KEY); } catch { /* storage may be unavailable */ }
    void store.load();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void store.restore(); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [store]);

  const addItem = async (variant: ProductVariant, _product: Product, quantity = 1) => {
    setIsOpen(true);
    await store.add([{ merchandiseId: variant.id, quantity }]);
  };

  return <CartContext.Provider value={{
    cart: state.cart, isOpen, isLoading: state.busy || !state.ready, error: state.error,
    openCart: () => setIsOpen(true), closeCart: () => setIsOpen(false), addItem,
    updateItemQuantity: store.update, removeItem: store.remove,
    totalQuantity: state.cart?.totalQuantity ?? 0, checkout: store.checkout, refreshCart: store.load,
  }}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
}

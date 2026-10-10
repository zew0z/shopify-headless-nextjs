"use client";

/**
 * Drop-in cart for a received frontend: wrap the layout in <CartProvider> and
 * call useCart() where their cart context used to be.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createCartStore, cartLines, type CartStore } from "./cart-store";
import { trackAddToCart } from "./analytics";

const CartContext = createContext<CartStore | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  // Adds are reported to Shopify analytics; nothing is sent unless <ShopifyAnalytics> is on the page and the visitor consented.
  const [store] = useState(() => createCartStore({ onAdd: trackAddToCart }));
  useEffect(() => {
    void store.load();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void store.restore(); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [store]);
  return <CartContext.Provider value={store}>{children}</CartContext.Provider>;
}

export function useCart() {
  const store = useContext(CartContext);
  if (!store) throw new Error("useCart() needs <CartProvider> around the page (put it in the root layout).");
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const lines = useMemo(() => cartLines(state.cart), [state.cart]);
  return {
    ...state,
    lines,
    count: state.cart?.totalQuantity ?? 0,
    add: store.add,
    update: store.update,
    remove: store.remove,
    applyDiscountCodes: store.applyDiscountCodes,
    checkout: store.checkout,
    refresh: store.load,
  };
}

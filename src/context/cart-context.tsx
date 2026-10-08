"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { Cart, ProductVariant, Product } from "@/lib/shopify/types";
import { cartAction, isShopifyCartId } from "@/lib/shopify/cart-client";
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
  checkoutUrl: string;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_ID_KEY = "shopify_cart_id";
// Older versions cached a locally built cart here; it is never trusted again.
const LEGACY_CART_STATE_KEY = "shopify_cart_state";

const NOT_CONNECTED = "This shop is not connected to Shopify yet, so the bag cannot be used.";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The cart lives in Shopify; the browser only keeps its id.
  useEffect(() => {
    localStorage.removeItem(LEGACY_CART_STATE_KEY);
    const storedId = localStorage.getItem(CART_ID_KEY);
    if (!isShopifyCartId(storedId)) {
      localStorage.removeItem(CART_ID_KEY);
      return;
    }
    cartAction({ action: "get", cartId: storedId })
      .then((found) => {
        if (found) setCart(found);
        else localStorage.removeItem(CART_ID_KEY); // Shopify drops carts after checkout or expiry
      })
      .catch((err) => console.warn("Could not load the Shopify cart", err));
  }, []);

  /** Runs one cart action and returns Shopify's cart. On failure the bag stays as it was, the error is shown and it returns null. */
  const run = async (body: Record<string, unknown>): Promise<Cart | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await cartAction(body);
      if (!next) throw new Error(NOT_CONNECTED);
      setCart(next);
      localStorage.setItem(CART_ID_KEY, next.id);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bag could not be updated.");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const openCart = () => setIsOpen(true);
  const closeCart = () => setIsOpen(false);

  const addItem = async (variant: ProductVariant, product: Product, quantity = 1) => {
    setIsOpen(true);
    const lines = [{ merchandiseId: variant.id, quantity }];
    const cartId = cart?.id ?? localStorage.getItem(CART_ID_KEY);
    const next = await run(isShopifyCartId(cartId) ? { action: "add", cartId, lines } : { action: "create", lines });
    if (next) trackAddToCart(next, lines);
  };

  const removeItem = async (lineId: string) => {
    if (!cart) return;
    await run({ action: "remove", cartId: cart.id, lineIds: [lineId] });
  };

  const updateItemQuantity = async (lineId: string, quantity: number) => {
    if (quantity <= 0) return removeItem(lineId);
    if (!cart) return;
    await run({ action: "update", cartId: cart.id, lines: [{ id: lineId, quantity }] });
  };

  const totalQuantity = cart?.totalQuantity || 0;
  const checkoutUrl = cart?.checkoutUrl || "";

  return (
    <CartContext.Provider
      value={{
        cart,
        isOpen,
        isLoading,
        error,
        openCart,
        closeCart,
        addItem,
        updateItemQuantity,
        removeItem,
        totalQuantity,
        checkoutUrl,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}

"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { Cart, CartLine, ProductVariant, Product } from "@/lib/shopify/types";

interface CartContextType {
  cart: Cart | null;
  isOpen: boolean;
  isLoading: boolean;
  openCart: () => void;
  closeCart: () => void;
  addItem: (variant: ProductVariant, product: Product, quantity?: number) => Promise<void>;
  updateItemQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeItem: (lineId: string) => Promise<void>;
  totalQuantity: number;
  subtotal: string;
  currency: string;
  checkoutUrl: string;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "shopify_cart_state";
const CART_ID_KEY = "shopify_cart_id";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load cart on mount & fetch fresh state from Shopify if cartId exists
  useEffect(() => {
    async function initializeCart() {
      try {
        const storedCart = localStorage.getItem(CART_STORAGE_KEY);
        const storedCartId = localStorage.getItem(CART_ID_KEY);

        if (storedCart) {
          setCart(JSON.parse(storedCart));
        }

        // If we have a Shopify cart ID, sync fresh state with Shopify
        if (storedCartId && storedCartId.startsWith("gid://shopify/Cart/")) {
          try {
            const res = await fetch("/api/cart", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "get", cartId: storedCartId }),
            });
            const data = await res.json();
            if (data.cart) {
              setCart(data.cart);
              localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(data.cart));
            }
          } catch (fetchErr) {
            console.warn("Could not refresh Shopify cart on load", fetchErr);
          }
        }
      } catch (e) {
        console.error("Failed reading cart from localStorage", e);
      } finally {
        setIsInitialized(true);
      }
    }

    initializeCart();
  }, []);

  // Sync cart to localStorage whenever it changes
  useEffect(() => {
    if (!isInitialized) return;
    if (cart) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      if (cart.id) {
        localStorage.setItem(CART_ID_KEY, cart.id);
      }
    } else {
      localStorage.removeItem(CART_STORAGE_KEY);
      localStorage.removeItem(CART_ID_KEY);
    }
  }, [cart, isInitialized]);

  const openCart = () => setIsOpen(true);
  const closeCart = () => setIsOpen(false);

  const addItem = async (variant: ProductVariant, product: Product, quantity = 1) => {
    setIsLoading(true);
    setIsOpen(true);

    try {
      const currentCartId = cart?.id || localStorage.getItem(CART_ID_KEY);
      const isShopifyId = currentCartId && currentCartId.startsWith("gid://shopify/Cart/");

      if (!isShopifyId) {
        // Create new Shopify cart with the line item
        const res = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            lines: [{ merchandiseId: variant.id, quantity }],
          }),
        });
        const data = await res.json();
        if (data.cart) {
          setCart(data.cart);
          return;
        }
      } else {
        // Add line to existing Shopify cart
        const res = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add",
            cartId: currentCartId,
            lines: [{ merchandiseId: variant.id, quantity }],
          }),
        });
        const data = await res.json();
        if (data.cart) {
          setCart(data.cart);
          return;
        }
      }
    } catch (err) {
      console.warn("Shopify API cart mutation failed, applying optimistic update:", err);
    } finally {
      setIsLoading(false);
    }

    // Fallback: Optimistic local update
    setCart((prev) => {
      const existingLines = prev?.lines.edges || [];
      const existingLineIndex = existingLines.findIndex(
        (e) => e.node.merchandise.id === variant.id
      );

      let newEdges: Array<{ node: CartLine }>;
      const itemPrice = parseFloat(variant.price.amount);
      const currency = variant.price.currencyCode;

      if (existingLineIndex > -1) {
        newEdges = existingLines.map((edge, idx) => {
          if (idx === existingLineIndex) {
            const newQty = edge.node.quantity + quantity;
            return {
              node: {
                ...edge.node,
                quantity: newQty,
                cost: {
                  totalAmount: {
                    amount: (itemPrice * newQty).toFixed(2),
                    currencyCode: currency,
                  },
                },
              },
            };
          }
          return edge;
        });
      } else {
        const newLine: CartLine = {
          id: `line_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          quantity,
          cost: {
            totalAmount: {
              amount: (itemPrice * quantity).toFixed(2),
              currencyCode: currency,
            },
          },
          merchandise: {
            id: variant.id,
            title: variant.title,
            selectedOptions: variant.selectedOptions,
            price: variant.price,
            product: {
              id: product.id,
              handle: product.handle,
              title: product.title,
              featuredImage: variant.image || product.featuredImage,
            },
          },
        };
        newEdges = [...existingLines, { node: newLine }];
      }

      const totalQty = newEdges.reduce((acc, curr) => acc + curr.node.quantity, 0);
      const subtotalVal = newEdges.reduce(
        (acc, curr) => acc + parseFloat(curr.node.cost.totalAmount.amount),
        0
      );

      return {
        id: prev?.id || `cart_${Date.now()}`,
        checkoutUrl: prev?.checkoutUrl || "/checkout",
        totalQuantity: totalQty,
        cost: {
          subtotalAmount: {
            amount: subtotalVal.toFixed(2),
            currencyCode: currency,
          },
          totalAmount: {
            amount: subtotalVal.toFixed(2),
            currencyCode: currency,
          },
        },
        lines: { edges: newEdges },
      };
    });
  };

  const updateItemQuantity = async (lineId: string, quantity: number) => {
    if (quantity <= 0) {
      await removeItem(lineId);
      return;
    }

    setIsLoading(true);
    try {
      const currentCartId = cart?.id;
      if (currentCartId && currentCartId.startsWith("gid://shopify/Cart/")) {
        const res = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            cartId: currentCartId,
            lines: [{ id: lineId, quantity }],
          }),
        });
        const data = await res.json();
        if (data.cart) {
          setCart(data.cart);
          return;
        }
      }
    } catch (err) {
      console.warn("Shopify cart update error:", err);
    } finally {
      setIsLoading(false);
    }

    // Local fallback update
    setCart((prev) => {
      if (!prev) return null;
      const newEdges = prev.lines.edges.map((edge) => {
        if (edge.node.id === lineId) {
          const unitPrice = parseFloat(edge.node.merchandise.price.amount);
          return {
            node: {
              ...edge.node,
              quantity,
              cost: {
                totalAmount: {
                  amount: (unitPrice * quantity).toFixed(2),
                  currencyCode: edge.node.cost.totalAmount.currencyCode,
                },
              },
            },
          };
        }
        return edge;
      });

      const totalQty = newEdges.reduce((acc, curr) => acc + curr.node.quantity, 0);
      const subtotalVal = newEdges.reduce(
        (acc, curr) => acc + parseFloat(curr.node.cost.totalAmount.amount),
        0
      );
      const currency = prev.cost.subtotalAmount.currencyCode;

      return {
        ...prev,
        totalQuantity: totalQty,
        cost: {
          ...prev.cost,
          subtotalAmount: { amount: subtotalVal.toFixed(2), currencyCode: currency },
          totalAmount: { amount: subtotalVal.toFixed(2), currencyCode: currency },
        },
        lines: { edges: newEdges },
      };
    });
  };

  const removeItem = async (lineId: string) => {
    setIsLoading(true);
    try {
      const currentCartId = cart?.id;
      if (currentCartId && currentCartId.startsWith("gid://shopify/Cart/")) {
        const res = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "remove",
            cartId: currentCartId,
            lineIds: [lineId],
          }),
        });
        const data = await res.json();
        if (data.cart) {
          setCart(data.cart);
          return;
        }
      }
    } catch (err) {
      console.warn("Shopify cart remove error:", err);
    } finally {
      setIsLoading(false);
    }

    // Local fallback
    setCart((prev) => {
      if (!prev) return null;
      const newEdges = prev.lines.edges.filter((edge) => edge.node.id !== lineId);
      const totalQty = newEdges.reduce((acc, curr) => acc + curr.node.quantity, 0);
      const subtotalVal = newEdges.reduce(
        (acc, curr) => acc + parseFloat(curr.node.cost.totalAmount.amount),
        0
      );
      const currency = prev.cost.subtotalAmount.currencyCode;

      return {
        ...prev,
        totalQuantity: totalQty,
        cost: {
          ...prev.cost,
          subtotalAmount: { amount: subtotalVal.toFixed(2), currencyCode: currency },
          totalAmount: { amount: subtotalVal.toFixed(2), currencyCode: currency },
        },
        lines: { edges: newEdges },
      };
    });
  };

  const totalQuantity = cart?.totalQuantity || 0;
  const subtotal = cart?.cost.subtotalAmount.amount || "0.00";
  const currency = cart?.cost.subtotalAmount.currencyCode || "EUR";
  const checkoutUrl = cart?.checkoutUrl || "";

  return (
    <CartContext.Provider
      value={{
        cart,
        isOpen,
        isLoading,
        openCart,
        closeCart,
        addItem,
        updateItemQuantity,
        removeItem,
        totalQuantity,
        subtotal,
        currency,
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

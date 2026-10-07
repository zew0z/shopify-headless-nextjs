/**
 * The cart's brain, without React: one change at a time, the cart id kept in
 * the browser, Shopify's cart as the only truth. cart-provider.tsx wraps it.
 */
import { cartAction, isShopifyCartId } from "./cart-client";
import type { Cart, CartItemInput, Money, SelectedOption, ShopifyImage } from "./types";

export interface CartState { cart: Cart | null; ready: boolean; busy: boolean; error: string | null }
export interface CartStorage { get(): string | null; set(id: string): void; clear(): void }
export interface CartStore {
  getState(): CartState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  add(lines: CartItemInput[]): Promise<void>;
  update(lineId: string, quantity: number): Promise<void>;
  remove(lineId: string): Promise<void>;
  applyDiscountCodes(codes: string[]): Promise<void>;
  checkout(): void;
}

export function localCartStorage(key = "shopify-cart-id"): CartStorage {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (id) => { try { localStorage.setItem(key, id); } catch { /* private mode: the cart lasts this visit */ } },
    clear: () => { try { localStorage.removeItem(key); } catch { /* nothing stored */ } },
  };
}

/**
 * Shopify answers a change to a cart it no longer has with a user error ("The
 * specified cart does not exist."), which /api/cart turns into a thrown error.
 * Reading such a cart gives null instead. Both mean the cart is gone.
 */
function isCartGone(err: unknown): boolean {
  return err instanceof Error && /cart does not exist/i.test(err.message);
}

export function createCartStore(options: { action?: typeof cartAction; storage?: CartStorage; goTo?: (url: string) => void } = {}): CartStore {
  const action = options.action ?? cartAction;
  const storage = options.storage ?? localCartStorage();
  const goTo = options.goTo ?? ((url: string) => { window.location.href = url; });
  let state: CartState = { cart: null, ready: false, busy: false, error: null };
  const listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();

  const set = (patch: Partial<CartState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const storedId = () => {
    const id = storage.get();
    return isShopifyCartId(id) ? id : null;
  };

  const keep = (cart: Cart | null) => {
    if (cart) storage.set(cart.id);
    else storage.clear();
    set({ cart, error: null });
  };

  // Changes wait for each other, so two quick clicks never create two carts.
  // A change that returns undefined has nothing to do and leaves the state alone.
  function run(change: () => Promise<Cart | null | undefined>): Promise<void> {
    const next = queue.then(async () => {
      set({ busy: true });
      try {
        const cart = await change();
        if (cart !== undefined) keep(cart);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : "The cart could not be updated" });
      } finally {
        set({ busy: false, ready: true });
      }
    });
    // A change that fails must not freeze the ones behind it; the caller still sees the failure.
    queue = next.catch(() => {});
    return next;
  }

  // For changes to the stored cart: if Shopify says it is gone, drop it and tell the shopper.
  async function changeStored(change: () => Promise<Cart | null>): Promise<Cart | null> {
    try {
      return await change();
    } catch (err) {
      if (!isCartGone(err)) throw err;
      storage.clear();
      set({ cart: null });
      throw new Error("Your cart expired. Add the items again.");
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => run(async () => {
      const cartId = storedId();
      return cartId ? action({ action: "get", cartId }) : null;
    }),
    add: (lines) => run(async () => {
      const cartId = storedId();
      if (cartId) {
        const cart = await action({ action: "add", cartId, lines }).catch((err) => {
          if (isCartGone(err)) return null;
          throw err;
        });
        if (cart) return cart;
        // Shopify no longer has this cart: forget it and start a new one with the same lines.
        storage.clear();
      }
      const created = await action({ action: "create", lines });
      if (!created) throw new Error("This shop is not connected to Shopify yet.");
      return created;
    }),
    update: (lineId, quantity) => run(async () => {
      const cartId = storedId();
      return cartId ? changeStored(() => action({ action: "update", cartId, lines: [{ id: lineId, quantity }] })) : undefined;
    }),
    remove: (lineId) => run(async () => {
      const cartId = storedId();
      return cartId ? changeStored(() => action({ action: "remove", cartId, lineIds: [lineId] })) : undefined;
    }),
    applyDiscountCodes: (codes) => run(async () => {
      const cartId = storedId();
      return cartId ? changeStored(() => action({ action: "discount", cartId, discountCodes: codes })) : undefined;
    }),
    checkout() {
      if (state.cart?.checkoutUrl) goTo(state.cart.checkoutUrl);
    },
  };
}

/** One cart line as a page shows it, flattened from Shopify's nested shape. */
export interface CartLineView {
  id: string;
  quantity: number;
  variantId: string;
  productTitle: string;
  productHandle: string;
  /** null for products with a single variant, which Shopify calls "Default Title". */
  variantTitle: string | null;
  options: SelectedOption[];
  image: ShopifyImage | null;
  unitPrice: Money;
  total: Money;
}

export function cartLines(cart: Cart | null): CartLineView[] {
  if (!cart) return [];
  return cart.lines.edges.map(({ node: line }) => ({
    id: line.id,
    quantity: line.quantity,
    variantId: line.merchandise.id,
    productTitle: line.merchandise.product.title,
    productHandle: line.merchandise.product.handle,
    variantTitle: line.merchandise.title === "Default Title" ? null : line.merchandise.title,
    options: line.merchandise.selectedOptions,
    image: line.merchandise.product.featuredImage,
    unitPrice: line.merchandise.price,
    total: line.cost.totalAmount,
  }));
}

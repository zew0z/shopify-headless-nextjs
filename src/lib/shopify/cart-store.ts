/**
 * The cart's brain, without React: one change at a time, the cart id kept in
 * the browser, Shopify's cart as the only truth. cart-provider.tsx wraps it.
 */
import { cartAction, cartCheckoutUrl, CartRequestError, isShopifyCartId } from "./cart-client";
import { stockLimit } from "./cart-utils";
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
  checkout(): Promise<void>;
  restore(): Promise<void>;
}

export function localCartStorage(key = "shopify-cart-id"): CartStorage {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (id) => { try { localStorage.setItem(key, id); } catch { /* private mode: the cart lasts this visit */ } },
    clear: () => { try { localStorage.removeItem(key); } catch { /* nothing stored */ } },
  };
}

/**
 * Shopify answers a change to a cart it no longer has with a user error, which
 * /api/cart exposes as the public notFound code. Older routes used provider text.
 * Reading such a cart gives null instead. Both mean the cart is gone.
 */
function isCartGone(err: unknown): boolean {
  return (err instanceof CartRequestError && err.code === "notFound") || (err instanceof Error && /cart does not exist/i.test(err.message));
}

export function createCartStore(
  options: {
    action?: typeof cartAction;
    storage?: CartStorage;
    goTo?: (url: string) => void;
    checkoutUrl?: typeof cartCheckoutUrl;
    /** Told about every successful add, with Shopify's cart (cart-provider passes Shopify analytics). Its failures are ignored. */
    onAdd?: (cart: Cart, lines: CartItemInput[]) => void;
  } = {}
): CartStore {
  const action = options.action ?? cartAction;
  const reportAdd = (cart: Cart, lines: CartItemInput[]) => {
    try {
      options.onAdd?.(cart, lines);
    } catch (err) {
      console.warn("[Shopify] The add-to-cart report failed:", err);
    }
  };
  const storage = options.storage ?? localCartStorage();
  const goTo = options.goTo ?? ((url: string) => { window.location.href = url; });
  let state: CartState = { cart: null, ready: false, busy: false, error: null };
  const listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  let departing = false;
  let departure = 0;

  const set = (patch: Partial<CartState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => { try { l(); } catch { /* one observer cannot freeze the cart queue */ } });
  };

  const storedId = () => {
    const id = storage.get();
    return isShopifyCartId(id) ? id : null;
  };

  const keep = (cart: Cart | null) => {
    if (cart) storage.set(cart.id);
    else storage.clear();
    set({ cart, error: cart?.warnings?.length ? "Shopify adjusted the items to match available stock. Review your cart before checkout." : null });
  };

  // Changes wait for each other, so two quick clicks never create two carts.
  // A change that returns undefined has nothing to do and leaves the state alone.
  function run(change: () => Promise<Cart | null | undefined>): Promise<void> {
    if (departing) return Promise.resolve();
    pending++;
    set({ busy: true });
    const next = queue.then(async () => {
      try {
        set({ busy: true });
        const cart = await change();
        if (cart !== undefined) keep(cart);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : "The cart could not be updated" });
      } finally {
        pending--;
        set({ busy: pending > 0 || departing, ready: true });
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
        if (cart) {
          reportAdd(cart, lines);
          return cart;
        }
        // Shopify no longer has this cart: forget it and start a new one with the same lines.
        storage.clear();
      }
      const created = await action({ action: "create", lines });
      if (!created) throw new Error("This shop is not connected to Shopify yet.");
      reportAdd(created, lines);
      return created;
    }),
    update: (lineId, quantity) => run(async () => {
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw new CartRequestError("Choose a whole quantity from 1 to 1000; use Remove to delete an item.", "invalid");
      const cartId = storedId();
      return cartId ? changeStored(() => action({ action: "update", cartId, lines: [{ id: lineId, quantity }] })) : undefined;
    }),
    remove: (lineId) => run(async () => {
      const cartId = storedId();
      return cartId ? changeStored(() => action({ action: "remove", cartId, lineIds: [lineId] })) : undefined;
    }),
    applyDiscountCodes: (codes) => run(async () => {
      if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string" || !code.trim())) throw new CartRequestError("Enter a discount code; use an empty list to clear codes.", "invalid");
      const cartId = storedId();
      return cartId ? changeStored(() => action({ action: "discount", cartId, discountCodes: codes.map((code) => code.trim()) })) : undefined;
    }),
    async checkout() {
      const cartId = storedId();
      if (departing || pending > 0 || !state.ready || state.error || !state.cart?.totalQuantity || !cartId) return;
      departing = true;
      const turn = ++departure;
      set({ busy: true });
      try {
        const url = await (options.checkoutUrl ?? cartCheckoutUrl)(cartId);
        if (turn !== departure) return;
        if (!url) throw new Error("Checkout is unavailable for this cart. Review the items before continuing.");
        goTo(url);
        // Remain busy while navigation is pending. A persisted pageshow releases this lock.
      } catch (error) {
        if (turn !== departure) return;
        departing = false;
        set({ busy: false, error: error instanceof Error ? error.message : "Checkout could not be opened." });
      }
    },
    restore() {
      departure++;
      departing = false;
      return run(async () => { const cartId = storedId(); return cartId ? action({ action: "get", cartId }) : null; });
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
  available: boolean;
  maxQuantity: number | null;
}

export function cartLines(cart: Cart | null): CartLineView[] {
  if (!cart) return [];
  return cart.lines.edges.map(({ node: line }) => ({
    id: line.id,
    quantity: line.quantity,
    available: line.merchandise.availableForSale !== false,
    maxQuantity: stockLimit(line.merchandise.availableForSale !== false, line.merchandise.quantityAvailable),
    variantId: line.merchandise.id,
    productTitle: line.merchandise.product.title,
    productHandle: line.merchandise.product.handle,
    variantTitle: line.merchandise.title === "Default Title" ? null : line.merchandise.title,
    options: line.merchandise.selectedOptions,
    image: line.merchandise.product.featuredImage,
    unitPrice: line.cost.amountPerQuantity ?? line.merchandise.price,
    total: line.cost.totalAmount,
  }));
}

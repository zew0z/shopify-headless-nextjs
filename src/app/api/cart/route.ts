import { NextRequest, NextResponse } from "next/server";
import {
  createCart,
  getCart,
  addToCart,
  updateCartLines,
  removeFromCart,
  applyDiscountCode,
  addGiftCard,
  removeGiftCard,
  updateCartBuyerIdentity,
} from "@/lib/shopify";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function validQuantities(lines: unknown, minimum: number, optional = false): boolean {
  if (lines === undefined) return optional;
  return Array.isArray(lines) && (optional || lines.length > 0) && lines.every((line) =>
    line && typeof line === "object" && Number.isSafeInteger(line.quantity) && line.quantity >= minimum && line.quantity <= 1000);
}

export async function POST(req: NextRequest) {
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid cart request", code: "invalid" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid cart request", code: "invalid" }, 400);
  try {
    const { action } = body;
    if ((action === "create" && !validQuantities(body.lines, 1, true)) ||
        (action === "add" && !validQuantities(body.lines, 1)) ||
        (action === "update" && !validQuantities(body.lines, 0))) {
      return reply({ error: "Cart quantities must be whole numbers within the supported range", code: "invalid" }, 400);
    }

    switch (action) {
      case "create": {
        const cart = await createCart(body.lines, body.buyerIdentity);
        return reply(cart);
      }
      case "get": {
        const cart = await getCart(body.cartId);
        return reply(cart);
      }
      case "add": {
        const cart = await addToCart(body.cartId, body.lines);
        return reply(cart);
      }
      case "update": {
        const cart = await updateCartLines(body.cartId, body.lines);
        return reply(cart);
      }
      case "remove": {
        const cart = await removeFromCart(body.cartId, body.lineIds);
        return reply(cart);
      }
      case "discount": {
        const cart = await applyDiscountCode(body.cartId, body.discountCodes);
        return reply(cart);
      }
      case "addGiftCard": {
        const cart = await addGiftCard(body.cartId, body.giftCardCodes);
        return reply(cart);
      }
      case "removeGiftCard": {
        if (!Array.isArray(body.appliedGiftCardIds)) {
          return reply(
            { error: "removeGiftCard needs appliedGiftCardIds (take them from cart.appliedGiftCards[].id); removing by code is no longer supported by Shopify", code: "invalid" },
            400
          );
        }
        const cart = await removeGiftCard(body.cartId, body.appliedGiftCardIds);
        return reply(cart);
      }
      case "buyerIdentity": {
        const cart = await updateCartBuyerIdentity(body.cartId, body.buyerIdentity);
        return reply(cart);
      }
      default:
        return reply({ error: "Invalid action", code: "invalid" }, 400);
    }
  } catch (error) {
    if (error instanceof Error && /cart does not exist/i.test(error.message)) {
      return reply({ error: "Your cart expired. Add the items again.", code: "notFound" }, 404);
    }
    // Backend error text can include buyer data. Expose a fixed message and never log its payload.
    return reply({ error: "Cart request failed. Check your cart before trying again.", code: "backend" }, 502);
  }
}

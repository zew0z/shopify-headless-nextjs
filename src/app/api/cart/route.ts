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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create": {
        const cart = await createCart(body.lines, body.buyerIdentity);
        return NextResponse.json(cart);
      }
      case "get": {
        const cart = await getCart(body.cartId);
        return NextResponse.json(cart);
      }
      case "add": {
        const cart = await addToCart(body.cartId, body.lines);
        return NextResponse.json(cart);
      }
      case "update": {
        const cart = await updateCartLines(body.cartId, body.lines);
        return NextResponse.json(cart);
      }
      case "remove": {
        const cart = await removeFromCart(body.cartId, body.lineIds);
        return NextResponse.json(cart);
      }
      case "discount": {
        const cart = await applyDiscountCode(body.cartId, body.discountCodes);
        return NextResponse.json(cart);
      }
      case "addGiftCard": {
        const cart = await addGiftCard(body.cartId, body.giftCardCodes);
        return NextResponse.json(cart);
      }
      case "removeGiftCard": {
        const cart = await removeGiftCard(body.cartId, body.giftCardCodes);
        return NextResponse.json(cart);
      }
      case "buyerIdentity": {
        const cart = await updateCartBuyerIdentity(body.cartId, body.buyerIdentity);
        return NextResponse.json(cart);
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cart action failed";
    console.error("[Cart API Route Error]:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

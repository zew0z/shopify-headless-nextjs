import { NextRequest, NextResponse } from "next/server";
import {
  createCart,
  getCart,
  addToCart,
  updateCartLines,
  removeFromCart,
  applyDiscountCode,
  updateCartBuyerIdentity,
} from "@/lib/shopify";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, cartId, lines, lineIds, discountCodes, buyerIdentity } = body;

    switch (action) {
      case "create": {
        const cart = await createCart(lines || [], buyerIdentity);
        return NextResponse.json({ cart });
      }
      case "get": {
        if (!cartId) return NextResponse.json({ error: "cartId required" }, { status: 400 });
        const cart = await getCart(cartId);
        return NextResponse.json({ cart });
      }
      case "add": {
        if (!cartId || !lines) return NextResponse.json({ error: "cartId and lines required" }, { status: 400 });
        const cart = await addToCart(cartId, lines);
        return NextResponse.json({ cart });
      }
      case "update": {
        if (!cartId || !lines) return NextResponse.json({ error: "cartId and lines required" }, { status: 400 });
        const cart = await updateCartLines(cartId, lines);
        return NextResponse.json({ cart });
      }
      case "remove": {
        if (!cartId || !lineIds) return NextResponse.json({ error: "cartId and lineIds required" }, { status: 400 });
        const cart = await removeFromCart(cartId, lineIds);
        return NextResponse.json({ cart });
      }
      case "discount": {
        if (!cartId || !discountCodes) return NextResponse.json({ error: "cartId and discountCodes required" }, { status: 400 });
        const cart = await applyDiscountCode(cartId, discountCodes);
        return NextResponse.json({ cart });
      }
      case "buyerIdentity": {
        if (!cartId || !buyerIdentity) return NextResponse.json({ error: "cartId and buyerIdentity required" }, { status: 400 });
        const cart = await updateCartBuyerIdentity(cartId, buyerIdentity);
        return NextResponse.json({ cart });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Cart Route Error]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

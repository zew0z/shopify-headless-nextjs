import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import crypto from "crypto";
import { shopifyConfig } from "@/lib/shopify/config";

/**
 * Shopify On-Demand ISR Cache Revalidation Route
 *
 * Listens for Shopify Admin Webhooks (products/create, products/update,
 * products/delete, collections/update, collections/delete) and clears Next.js
 * tag-based data caches instantly.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const topic = req.headers.get("x-shopify-topic"); // e.g. "products/update"
    const shopDomain = req.headers.get("x-shopify-shop-domain");

    // 1. Verify HMAC if secret is configured
    if (shopifyConfig.webhookSecret) {
      if (!hmacHeader) {
        return NextResponse.json({ error: "Missing x-shopify-hmac-sha256 header" }, { status: 401 });
      }

      const hash = crypto
        .createHmac("sha256", shopifyConfig.webhookSecret)
        .update(rawBody, "utf8")
        .digest("base64");

      const hashBuffer = Buffer.from(hash);
      const headerBuffer = Buffer.from(hmacHeader);

      if (hashBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(hashBuffer, headerBuffer)) {
        return NextResponse.json({ error: "Invalid HMAC signature" }, { status: 401 });
      }
    }

    let payload: Record<string, unknown> = {};
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        // payload might be plain or empty
      }
    }

    const handle = typeof payload.handle === "string" ? payload.handle : null;
    const revalidatedTags: string[] = [];

    const purgeTag = (tag: string) => {
      // In Next.js 16, revalidateTag accepts { expire: 0 } for immediate purge
      // Cast through unknown to remain backwards/forwards compatible across Next versions
      try {
        (revalidateTag as unknown as (tag: string, profile?: unknown) => void)(tag, { expire: 0 });
      } catch {
        (revalidateTag as unknown as (tag: string) => void)(tag);
      }
      revalidatedTags.push(tag);
    };

    // 2. Perform granular tag invalidation based on topic
    if (topic?.startsWith("products/")) {
      purgeTag("products");

      if (handle) {
        purgeTag(`product-${handle}`);
      }
    } else if (topic?.startsWith("collections/")) {
      purgeTag("collections");

      if (handle) {
        purgeTag(`collection-${handle}`);
      }
    } else {
      // General invalidation fallback
      purgeTag("products");
      purgeTag("collections");
    }

    console.log(`[Shopify Webhook] Topic: ${topic} from ${shopDomain}. Revalidated: ${revalidatedTags.join(", ")}`);

    return NextResponse.json({
      success: true,
      topic,
      revalidatedTags,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Shopify Webhook Error]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { checkShopifyConnection } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostic = await checkShopifyConnection();

  return NextResponse.json(
    {
      status: diagnostic.canConnect ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      shopify: diagnostic,
    },
    {
      status: diagnostic.canConnect ? 200 : 503,
    }
  );
}

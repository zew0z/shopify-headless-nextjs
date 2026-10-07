import { NextRequest, NextResponse } from "next/server";
import { predictiveSearch } from "@/lib/shopify";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "5", 10);

  if (!query.trim()) {
    return NextResponse.json({ queries: [], products: [], collections: [] });
  }

  try {
    const results = await predictiveSearch(query, { limit });
    return NextResponse.json(results);
  } catch (error) {
    console.error("[Search Route Error]:", error);
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

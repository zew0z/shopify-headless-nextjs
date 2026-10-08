import { readAnalyticsConfig, analyticsRequestOrigin, analyticsPaths } from "@/lib/shopify/analytics-config";
import { PRIVATE_ANALYTICS_HEADERS } from "@/lib/shopify/analytics-policy";
import { getProduct } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const { config } = readAnalyticsConfig();
  if (!config || !analyticsRequestOrigin(request, config)) return Response.json({ enabled: false }, { status: 403, headers: PRIVATE_ANALYTICS_HEADERS });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ enabled: false }, { status: 415, headers: PRIVATE_ANALYTICS_HEADERS });
  try {
    const text = await request.text();
    if (text.length > 4096) throw new Error();
    const { path } = JSON.parse(text);
    return Response.json({ ...config, publicPaths: await analyticsPaths(path, config, getProduct) }, { headers: PRIVATE_ANALYTICS_HEADERS });
  } catch { return Response.json({ enabled: false }, { status: 400, headers: PRIVATE_ANALYTICS_HEADERS }); }
}

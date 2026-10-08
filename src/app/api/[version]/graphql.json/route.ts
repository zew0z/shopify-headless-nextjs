import { forwardStorefrontRequest } from "@/lib/shopify/storefront-proxy";

// Shopify's privacy and analytics scripts reach the Storefront API through this
// site's own domain (as on Hydrogen), so Shopify can count visitors.
type Context = { params: Promise<{ version: string }> };

async function handle(request: Request, { params }: Context) {
  return forwardStorefrontRequest(request, (await params).version);
}

export { handle as GET, handle as POST, handle as OPTIONS };

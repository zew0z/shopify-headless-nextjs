/** Exact approved hosts only. The navigation URL is returned only at checkout. */
export function validateCheckoutUrl(value: string, domain: string, additionalHosts = ""): string {
  const url = new URL(value);
  const allowed = [domain, "checkout.shopify.com", ...additionalHosts.split(",")].map((host) => host.trim().toLowerCase()).filter(Boolean);
  // Match the Astro adapter's explicit public-demo mode, without widening merchant hosts.
  const demo = domain === "mock.shop" && url.hostname.endsWith(".mock.shop");
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(allowed.includes(url.hostname) || demo)) {
    throw new Error("Shopify returned an invalid hosted checkout address.");
  }
  return url.href;
}

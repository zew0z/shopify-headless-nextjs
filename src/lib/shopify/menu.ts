/**
 * Shopify menu items carry full URLs on the shop's domain. A storefront needs
 * paths on its own site. Safe in client components: imports only types.
 */
import type { Menu, MenuItem, MenuLink } from "./types";

function toLink(item: MenuItem, hosts: string[]): MenuLink {
  const raw = item.url ?? "";
  let href = raw;
  let external = false;
  try {
    const url = new URL(raw);
    if (hosts.includes(url.host) || url.host.endsWith(".myshopify.com")) href = `${url.pathname}${url.search}` || "/";
    else external = true;
  } catch {
    // Already a path.
  }
  return { title: item.title, href, external, items: item.items.map((i) => toLink(i, hosts)) };
}

function keep(link: MenuLink, routes: RegExp[] | undefined, dropped: MenuLink[]): MenuLink | null {
  const items = link.items.map((l) => keep(l, routes, dropped)).filter((l): l is MenuLink => l !== null);
  const routed = link.external || !routes || link.href === "/" || routes.some((r) => r.test(link.href));
  if (!routed) {
    dropped.push({ ...link, items });
    return null;
  }
  return { ...link, items };
}

/** Menu links for this site. Internal links with no matching route are dropped and returned for the owner. */
export function menuLinks(menu: Menu | null, options: { hosts: string[]; routes?: RegExp[] }): { links: MenuLink[]; dropped: MenuLink[] } {
  const dropped: MenuLink[] = [];
  if (!menu) return { links: [], dropped };
  const links = menu.items
    .map((item) => keep(toLink(item, options.hosts), options.routes, dropped))
    .filter((l): l is MenuLink => l !== null);
  return { links, dropped };
}

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
  return { title: item.title, href, external, items: (item.items ?? []).map((i) => toLink(i, hosts)) };
}

/** Keeps a link if the site has a route for it. A dropped link hands its routable children up to its own place. */
function keep(link: MenuLink, routes: RegExp[] | undefined, dropped: MenuLink[]): MenuLink[] {
  const items = link.items.flatMap((l) => keep(l, routes, dropped));
  const routed = link.external || !routes || link.href === "/" || routes.some((r) => r.test(link.href));
  if (!routed) {
    dropped.push({ ...link, items });
    return items;
  }
  return [{ ...link, items }];
}

/**
 * Menu links for this site. Internal links with no matching route are dropped and returned for the owner.
 * When a parent is dropped, its routable children are not lost: they move up into the parent's place.
 */
export function menuLinks(menu: Menu | null, options: { hosts: string[]; routes?: RegExp[] }): { links: MenuLink[]; dropped: MenuLink[] } {
  const dropped: MenuLink[] = [];
  if (!menu) return { links: [], dropped };
  const links = menu.items.flatMap((item) => keep(toLink(item, options.hosts), options.routes, dropped));
  return { links, dropped };
}

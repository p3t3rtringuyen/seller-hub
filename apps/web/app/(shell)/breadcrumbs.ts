import type { Crumb } from "@seller-hub/ui";
import { shellMessages } from "./messages";

export interface RouteLabel {
  href: string;
  label: string;
}

function humanize(segment: string): string {
  const s = decodeURIComponent(segment).replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Breadcrumbs for every page (UX-25): Home, then one crumb per path segment. A segment whose cumulative path is a
 * registered nav entry uses that entry's label; others are humanised. The last crumb is the page title.
 */
export function buildBreadcrumbs(
  pathname: string,
  known: readonly RouteLabel[],
): { crumbs: Crumb[]; title: string } {
  const segments = pathname.split("/").filter(Boolean);
  const labelOf = new Map(known.map((k) => [k.href, k.label]));
  const crumbs: Crumb[] = [];
  let path = "";
  for (const seg of segments) {
    path += `/${seg}`;
    crumbs.push({ label: labelOf.get(path) ?? humanize(seg), href: path });
  }
  const title = crumbs.at(-1)?.label ?? shellMessages.home;
  if (crumbs.length === 0) return { crumbs: [{ label: shellMessages.home }], title };
  const [last, ...rest] = [...crumbs].reverse();
  const trail: Crumb[] = [
    { label: shellMessages.home, href: "/" },
    ...rest.reverse(),
    { label: last!.label },
  ];
  return { crumbs: trail, title };
}

import type { ShellNavSection } from "@seller-hub/ui";
import type { NavEntry } from "../../nav.generated";
import { messagesByLocale } from "../../messages.generated";
import { sectionLabels } from "./messages";

/** Namespace of a slice's message file: the first two dot-segments of the nav id ("ads.campaigns" -> same). */
export function namespaceOf(entry: Pick<NavEntry, "id">): string {
  return entry.id.split(".").slice(0, 2).join(".");
}

export function labelFor(entry: NavEntry, locale = "en"): string {
  const ns = messagesByLocale[locale]?.[namespaceOf(entry)];
  const value = ns?.[entry.labelKey];
  return typeof value === "string" && value ? value : entry.labelKey;
}

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, " ");
}

/**
 * Sidebar sections from the generated nav registry. Hiding a menu item is not access control (UX-19): each route
 * gates itself; here an entry without the permission is simply not offered. While roles load nothing is offered.
 */
export function buildNavSections(
  entries: readonly NavEntry[],
  can: (permission: string) => boolean,
  locale = "en",
): ShellNavSection[] {
  const visible = entries.filter((e) => can(e.permission));
  const order: string[] = [];
  const bySection = new Map<string, NavEntry[]>();
  for (const entry of visible) {
    if (!bySection.has(entry.section)) {
      bySection.set(entry.section, []);
      order.push(entry.section);
    }
    bySection.get(entry.section)!.push(entry);
  }
  return order.map((section) => ({
    id: section,
    label: sectionLabels[section] ?? titleCase(section),
    items: bySection
      .get(section)!
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, label: labelFor(e, locale), href: e.href })),
  }));
}

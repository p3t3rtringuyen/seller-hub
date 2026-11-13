// Copy of the shell itself (conventions §9, UX-22): section titles and the overrides this app applies to the design
// system's default strings. Slice copy lives in apps/web/messages/<locale>/<module>.<key>.json.

/** nav `section` id -> sidebar heading. Unknown sections fall back to the capitalised id. */
export const sectionLabels: Record<string, string> = {
  ads: "Advertising",
  listings: "Listings",
  inventory: "Inventory",
  orders: "Orders",
  sales: "Sales",
  finance: "Finance",
  automation: "Automation",
  settings: "Settings",
  example: "Example",
};

/** Overrides for `UiMessagesProvider` (the design system ships English defaults). */
export const uiMessageOverrides: Record<string, string> = {};

export const shellMessages = {
  brand: "seller-hub",
  home: "Home",
  signOut: "Sign out",
} as const;

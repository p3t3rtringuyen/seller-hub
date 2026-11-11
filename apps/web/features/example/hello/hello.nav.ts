// EXAMPLE — the nav convention: `<k>.nav.ts` default-exports one entry or an array of
// { id, labelKey, href, section, order, permission }. Plain data; apps/web does not import packages/core.
export default {
  id: "example.hello",
  labelKey: "nav",
  href: "/example",
  section: "example",
  order: 900,
  permission: "example.read",
};

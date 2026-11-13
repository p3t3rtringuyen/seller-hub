// URL state helpers (UX-07, UX-08, UX-09). The address is a chain  page -> tab -> sub-tab -> modal.
//  - a level is valid only under its parent; changing a level clears everything below it;
//  - invalid params are dropped with a replace (no history entry);
//  - opening a modal pushes a history entry, closing replaces it;
//  - each tab keeps its own search/filters/sort/page under a prefix (the first tab keeps bare names);
//  - account, date range and page size are shared (never prefixed);
//  - query strings are written readably (/, :, comma stay literal).
// Pure functions; the app wires them to its router (nuqs / next/navigation). Not in the URL: tabs inside a form,
// confirm dialogs, inline edit cards, filters' popovers, column pickers, view-only drawers, selection-based modals.

export interface UrlSchema {
  /** tab -> valid sub-tabs and modals under it. The first key is the default tab. */
  tabs: Readonly<Record<string, { subs?: readonly string[]; modals?: readonly string[] }>>;
  /** Params shared by every tab (never prefixed): account, range, page size ... */
  shared?: readonly string[];
}

export interface ChainState {
  tab: string;
  sub?: string | undefined;
  modal?: string | undefined;
  /** Entity id of the modal (e.g. Amazon's rule id, not a row id). */
  id?: string | undefined;
}

export const PARAM = { tab: "tab", sub: "sub", modal: "modal", id: "id" } as const;

export type Query = Record<string, string>;

export function parseQuery(search: string): Query {
  const q: Query = {};
  const s = search.startsWith("?") ? search.slice(1) : search;
  for (const part of s.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = decodeURIComponent((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, " "));
    const v = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
    q[k] = v;
  }
  return q;
}

/** `/`, `:` and `,` stay literal so addresses read well (UX-09). */
export function stringifyQuery(q: Query): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => {
      const enc = (s: string) =>
        encodeURIComponent(s)
          .replace(/%2F/gi, "/")
          .replace(/%3A/gi, ":")
          .replace(/%2C/gi, ",")
          .replace(/%5B/gi, "[")
          .replace(/%5D/gi, "]");
      return `${enc(k)}=${enc(v)}`;
    });
  return parts.length ? `?${parts.join("&")}` : "";
}

export interface ParsedChain {
  state: ChainState;
  /** Params that were invalid under their parent and must be removed with a `replace`. */
  dropped: string[];
}

export function defaultTab(schema: UrlSchema): string {
  const first = Object.keys(schema.tabs)[0];
  if (!first) throw new Error("UrlSchema needs at least one tab");
  return first;
}

/** Validates the chain; a level is valid only under its parent. */
export function parseChain(query: Query, schema: UrlSchema): ParsedChain {
  const dropped: string[] = [];
  const asked = query[PARAM.tab];
  let tab = defaultTab(schema);
  if (asked !== undefined) {
    if (asked in schema.tabs) tab = asked;
    else dropped.push(PARAM.tab);
  }
  const node = schema.tabs[tab] ?? {};
  const state: ChainState = { tab };
  const sub = query[PARAM.sub];
  if (sub !== undefined) {
    if (node.subs?.includes(sub)) state.sub = sub;
    else dropped.push(PARAM.sub);
  }
  const modal = query[PARAM.modal];
  if (modal !== undefined) {
    // A modal under a dropped sub-tab chain is invalid too: the modal belongs to the tab.
    if (node.modals?.includes(modal) && !dropped.includes(PARAM.sub)) {
      state.modal = modal;
      const id = query[PARAM.id];
      if (id) state.id = id;
    } else dropped.push(PARAM.modal);
  }
  if (query[PARAM.id] !== undefined && state.modal === undefined) dropped.push(PARAM.id);
  return { state, dropped };
}

/** Param name of a listing field inside a tab: bare for the first tab, `<tab>.<name>` for the others (UX-09). */
export function listingParam(schema: UrlSchema, tab: string, name: string): string {
  if (schema.shared?.includes(name)) return name;
  return tab === defaultTab(schema) ? name : `${tab}.${name}`;
}

/** Builds the query for a chain, keeping unrelated params. Changing a level clears everything below it. */
export function buildQuery(
  current: Query,
  next: Partial<ChainState> & { tab?: string },
  schema: UrlSchema,
): Query {
  const out: Query = { ...current };
  for (const k of [PARAM.tab, PARAM.sub, PARAM.modal, PARAM.id]) delete out[k];
  const parsed = parseChain(current, schema).state;
  const tabChanged = next.tab !== undefined && next.tab !== parsed.tab;
  const tab = next.tab ?? parsed.tab;
  if (tab !== defaultTab(schema)) out[PARAM.tab] = tab;
  const subChanged = "sub" in next && next.sub !== parsed.sub;
  const sub = tabChanged ? next.sub : "sub" in next ? next.sub : parsed.sub;
  if (sub) out[PARAM.sub] = sub;
  const modal = tabChanged || subChanged ? next.modal : "modal" in next ? next.modal : parsed.modal;
  if (modal) {
    out[PARAM.modal] = modal;
    const id = "id" in next ? next.id : tabChanged || subChanged ? undefined : parsed.id;
    if (id) out[PARAM.id] = id;
  }
  return out;
}

/** History mode: opening a modal pushes (Back closes it), everything else, including closing, replaces. */
export function historyMode(from: ChainState, to: ChainState): "push" | "replace" {
  const opening = to.modal !== undefined && to.modal !== from.modal;
  if (opening) return "push";
  const tabOrSubChange = from.tab !== to.tab || from.sub !== to.sub;
  return tabOrSubChange ? "push" : "replace";
}

/** Leaving a page strips the tab/sub/modal params of both pages. */
export function stripChain(q: Query): Query {
  const out = { ...q };
  for (const k of [PARAM.tab, PARAM.sub, PARAM.modal, PARAM.id]) delete out[k];
  return out;
}

/** Removes the params of `names` plus any tab-prefixed variant. */
export function dropParams(q: Query, names: readonly string[]): Query {
  const out = { ...q };
  for (const n of names) delete out[n];
  return out;
}

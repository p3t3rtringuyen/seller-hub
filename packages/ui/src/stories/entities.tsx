import type { ReactNode } from "react";
import { StatusChip } from "../fields/StatusChip";
import type { CompareValue, GridColumn } from "../datagrid/types";

// Synthetic data for stories and tests (no real seller data). Models the Ads console's entity tabs: the campaigns
// page switches between campaigns / ad groups / keywords / product targets / auto targets, each with its own
// columns (UX-04: the skeleton must follow the entity being loaded).

export type DemoRow = { id: string } & Record<string, string | number>;

export interface DemoEntity {
  id: "campaigns" | "adGroups" | "keywords" | "productTargets" | "autoTargets";
  label: string;
  columns: GridColumn<DemoRow>[];
  makeRows: (count: number, offset?: number) => DemoRow[];
  totals: (rows: readonly DemoRow[]) => Record<string, ReactNode>;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const int = (n: number) => String(Math.round(n));
const pct = (n: number) => `${n.toFixed(2)}%`;

const text = (
  id: string,
  header: string,
  width: number,
  extra: Partial<GridColumn<DemoRow>> = {},
): GridColumn<DemoRow> => ({
  id,
  header,
  width,
  sortable: true,
  cell: (r) => r[id] as string,
  text: (r) => String(r[id]),
  ...extra,
});
const status = (width = 110): GridColumn<DemoRow> => ({
  id: "state",
  header: "State",
  width,
  sortable: true,
  skeleton: "chip",
  cell: (r) => <StatusChip status={String(r.state)} />,
});
const num = (
  id: string,
  header: string,
  width: number,
  fmt: (n: number) => string,
  extra: Partial<GridColumn<DemoRow>> = {},
): GridColumn<DemoRow> => ({
  id,
  header,
  width,
  numeric: true,
  sortable: true,
  hasTotal: true,
  cell: (r) => fmt(Number(r[id])),
  text: (r) => fmt(Number(r[id])),
  compareCell: (r): CompareValue => {
    const now = Number(r[id]);
    const prev = now * 0.9;
    return { previous: fmt(prev), delta: "+11.1%", direction: "up", good: true };
  },
  ...extra,
});

const states = ["enabled", "paused", "archived"] as const;
const cycle = <T,>(arr: readonly T[], i: number) => arr[i % arr.length] as T;
const base = (i: number) => ({
  impressions: 1000 + ((i * 7919) % 90000),
  clicks: 10 + ((i * 131) % 900),
  spend: 5 + ((i * 37) % 700) + 0.35,
  sales: 8 + ((i * 53) % 2100) + 0.1,
  orders: 1 + ((i * 11) % 60),
});
const sumOf = (rows: readonly DemoRow[], key: string) =>
  rows.reduce((n, r) => n + Number(r[key]), 0);

const metricsTotals = (rows: readonly DemoRow[]): Record<string, ReactNode> => {
  const spend = sumOf(rows, "spend");
  const sales = sumOf(rows, "sales");
  const clicks = sumOf(rows, "clicks");
  const impressions = sumOf(rows, "impressions");
  return {
    impressions: int(impressions),
    clicks: int(clicks),
    ctr: impressions ? pct((clicks / impressions) * 100) : "—",
    spend: money(spend),
    sales: money(sales),
    orders: int(sumOf(rows, "orders")),
    // Ratios come from summed numerators / denominators, never an average of row ratios.
    acos: sales ? pct((spend / sales) * 100) : "—",
    budget: "",
    bid: "",
  };
};

const metricCols = (): GridColumn<DemoRow>[] => [
  num("impressions", "Impressions", 120, int),
  num("clicks", "Clicks", 96, int),
  num("ctr", "CTR", 88, pct),
  num("spend", "Spend", 108, money),
  num("sales", "Sales", 108, money),
  num("orders", "Orders", 92, int),
  num("acos", "ACOS", 92, pct),
];

function rowsFor(entity: DemoEntity["id"], count: number, offset: number): DemoRow[] {
  return Array.from({ length: count }, (_, k) => {
    const i = k + offset;
    const m = base(i);
    const row: DemoRow = {
      id: `${entity}-${i + 1}`,
      state: cycle(states, i),
      ...m,
      ctr: (m.clicks / m.impressions) * 100,
      acos: (m.spend / m.sales) * 100,
      budget: 10 + (i % 40),
      bid: 0.35 + (i % 9) / 10,
      // Long values on purpose: they must truncate with an ellipsis, not clip.
      name: `Sponsored Products — Spring ${i + 1} — Auto — Best sellers in kitchen & dining category long name`,
      campaign: `Campaign ${(i % 12) + 1} — Exact — US marketplace launch promotion`,
      adGroup: `Ad group ${(i % 20) + 1} — Hero SKUs`,
      keyword: `stainless steel insulated water bottle ${i + 1}`,
      matchType: cycle(["exact", "phrase", "broad"], i),
      target: `B0${String(10000000 + i).slice(0, 8)}`,
      expression: cycle(["asin", "category", "asin-expanded"], i),
      group: cycle(["Close match", "Loose match", "Substitutes", "Complements"], i),
      type: cycle(["Auto", "Manual"], i),
    };
    return row;
  });
}

const budgetCol = (): GridColumn<DemoRow> => ({
  id: "budget",
  header: "Budget",
  width: 140,
  numeric: true,
  exempt: true,
  skeleton: "number",
  cell: (r) => money(Number(r.budget)),
  text: (r) => money(Number(r.budget)),
});
const bidCol = (): GridColumn<DemoRow> => ({
  id: "bid",
  header: "Bid",
  width: 120,
  numeric: true,
  exempt: true,
  skeleton: "number",
  cell: (r) => money(Number(r.bid)),
  text: (r) => money(Number(r.bid)),
});

export const entities: Record<DemoEntity["id"], DemoEntity> = {
  campaigns: {
    id: "campaigns",
    label: "Campaigns",
    columns: [
      text("name", "Campaign", 280, { skeleton: "text", pinnable: true }),
      status(),
      text("type", "Type", 92),
      budgetCol(),
      ...metricCols(),
    ],
    makeRows: (n, o = 0) => rowsFor("campaigns", n, o),
    totals: metricsTotals,
  },
  adGroups: {
    id: "adGroups",
    label: "Ad groups",
    columns: [
      text("adGroup", "Ad group", 240),
      text("campaign", "Campaign", 240),
      status(104),
      bidCol(),
      ...metricCols().filter((c) => c.id !== "orders"),
    ],
    makeRows: (n, o = 0) => rowsFor("adGroups", n, o),
    totals: metricsTotals,
  },
  keywords: {
    id: "keywords",
    label: "Keywords",
    columns: [
      text("keyword", "Keyword", 260),
      text("matchType", "Match type", 104),
      text("campaign", "Campaign", 220),
      text("adGroup", "Ad group", 180),
      status(100),
      bidCol(),
      ...metricCols().filter((c) => c.id !== "ctr" && c.id !== "orders"),
    ],
    makeRows: (n, o = 0) => rowsFor("keywords", n, o),
    totals: metricsTotals,
  },
  productTargets: {
    id: "productTargets",
    label: "Product targets",
    columns: [
      text("target", "Target", 200),
      text("expression", "Expression", 140),
      text("campaign", "Campaign", 220),
      status(100),
      bidCol(),
      ...metricCols().filter((c) => c.id !== "ctr"),
    ],
    makeRows: (n, o = 0) => rowsFor("productTargets", n, o),
    totals: metricsTotals,
  },
  autoTargets: {
    id: "autoTargets",
    label: "Auto targets",
    columns: [
      text("group", "Targeting group", 190),
      text("campaign", "Campaign", 240),
      status(100),
      bidCol(),
      ...metricCols().filter((c) => c.id !== "orders" && c.id !== "ctr"),
    ],
    makeRows: (n, o = 0) => rowsFor("autoTargets", n, o),
    totals: metricsTotals,
  },
};

export const entityList = Object.values(entities);

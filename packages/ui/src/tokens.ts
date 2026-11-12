// Design tokens (colour, type, spacing, radius, elevation). One neutral, dense, data-first palette; the light and
// dark schemes share the same names. No Amazon branding (D51). Components read the MUI theme (CSS variables),
// never these constants directly, except for the few layout numbers the table needs to size itself.

export const palette = {
  light: {
    primary: "#1f5fbf",
    primaryContrast: "#ffffff",
    secondary: "#4a5568",
    background: "#f6f7f9",
    surface: "#ffffff",
    border: "#d9dde3",
    text: "#1a202c",
    textMuted: "#5a6577",
    success: "#1b7f4b",
    warning: "#b45309",
    error: "#c0392b",
    info: "#0b6fa4",
    skeleton: "#e3e7ec",
  },
  dark: {
    primary: "#6ea8ff",
    primaryContrast: "#0b1220",
    secondary: "#a0aec0",
    background: "#10151c",
    surface: "#18202a",
    border: "#2b3542",
    text: "#e6e9ee",
    textMuted: "#9aa5b5",
    success: "#4cc38a",
    warning: "#f0a04b",
    error: "#ff7b6b",
    info: "#5cb8e6",
    skeleton: "#263140",
  },
} as const;

/** Categorical series colours for charts (colour-blind safe order, same in both schemes). */
export const chartColors = [
  "#2f6fdc",
  "#e08a00",
  "#1b9e77",
  "#c2410c",
  "#7c3aed",
  "#0891b2",
] as const;

export const spacing = 8; // MUI spacing unit in px
export const radius = { sm: 4, md: 6, lg: 10, pill: 999 } as const;
export const elevation = {
  none: "none",
  card: "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1)",
  popover: "0 8px 24px rgba(16, 24, 40, 0.16)",
} as const;
export const fontFamily =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const monoFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Table geometry. Skeleton and loaded rows read the same numbers, so nothing shifts when data arrives (UX-04). */
export const grid = {
  rowHeight: { compact: 32, comfortable: 40 },
  /** Row height while compare is on: value line plus previous-period line. */
  compareRowHeight: { compact: 48, comfortable: 56 },
  headerHeight: 40,
  totalsHeight: 40,
  cellPaddingX: 12,
  selectionWidth: 44,
  minColumnWidth: 64,
  defaultPageSizes: [25, 50, 100],
} as const;
export type Density = keyof typeof grid.rowHeight;

"use client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { FilterIcon } from "../icons";
import { useMessages, type MessageKey } from "../messages";
import { MoneyField, IntegerField, PercentField } from "../fields/NumericFields";
import { SearchField } from "../fields/SearchField";

export type FilterOp = "gt" | "gte" | "lt" | "lte" | "eq";
export interface MetricFilterSpec {
  id: string;
  label: string;
  kind: "money" | "integer" | "percent" | "decimal";
}
export interface MetricFilter {
  metric: string;
  op: FilterOp;
  value: string;
}
export interface QuickChip {
  id: string;
  label: string;
}

export interface FilterBarProps {
  metrics: readonly MetricFilterSpec[];
  filters: readonly MetricFilter[];
  onFiltersChange: (next: MetricFilter[]) => void;
  search?: { value: string; onSearch: (v: string) => void; placeholder?: string };
  quickChips?: readonly QuickChip[];
  activeChips?: readonly string[];
  onChipsChange?: (next: string[]) => void;
  /** Currency of the marketplace, for money thresholds. */
  currency: string;
}

const ops: FilterOp[] = ["gt", "gte", "lt", "lte", "eq"];

/** Search + metric threshold filters (`filter[metric][op]`) + quick chips. Rendered inside the grid toolbar. */
export function FilterBar({
  metrics,
  filters,
  onFiltersChange,
  search,
  quickChips,
  activeChips = [],
  onChipsChange,
  currency,
}: FilterBarProps) {
  const t = useMessages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<MetricFilter>({
    metric: metrics[0]?.id ?? "",
    op: "gt",
    value: "",
  });
  const spec = metrics.find((m) => m.id === draft.metric);
  const labelOf = (id: string) => metrics.find((m) => m.id === id)?.label ?? id;

  const field = () => {
    const common = {
      label: t("filters.value"),
      value: draft.value,
      onChange: (value: string) => setDraft({ ...draft, value }),
    };
    if (spec?.kind === "money") return <MoneyField {...common} currency={currency} />;
    if (spec?.kind === "percent") return <PercentField {...common} allowDecimal />;
    if (spec?.kind === "decimal") return <PercentField {...common} allowDecimal />;
    return <IntegerField {...common} />;
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      {search ? (
        <SearchField
          value={search.value}
          onSearch={search.onSearch}
          {...(search.placeholder ? { placeholder: search.placeholder } : {})}
        />
      ) : null}
      {quickChips?.map((c) => {
        const on = activeChips.includes(c.id);
        return (
          <Chip
            key={c.id}
            label={c.label}
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            aria-pressed={on}
            onClick={() =>
              onChipsChange?.(on ? activeChips.filter((x) => x !== c.id) : [...activeChips, c.id])
            }
          />
        );
      })}
      {filters.map((f, i) => (
        <Chip
          key={`${f.metric}-${f.op}-${i}`}
          label={`${labelOf(f.metric)} ${t(`filters.op.${f.op}` as MessageKey)} ${f.value}`}
          onDelete={() => onFiltersChange(filters.filter((_, j) => j !== i))}
        />
      ))}
      <Button
        startIcon={<FilterIcon fontSize="small" />}
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {t("filters.add")}
      </Button>
      {filters.length > 0 ? (
        <Button color="inherit" onClick={() => onFiltersChange([])}>
          {t("filters.clearAll")}
        </Button>
      ) : null}
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <Stack spacing={1.5} sx={{ p: 2, width: 280 }}>
          <TextField
            select
            label={t("filters.metric")}
            value={draft.metric}
            onChange={(e) => setDraft({ ...draft, metric: e.target.value, value: "" })}
          >
            {metrics.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t("filters.operator")}
            value={draft.op}
            onChange={(e) => setDraft({ ...draft, op: e.target.value as FilterOp })}
          >
            {ops.map((o) => (
              <MenuItem key={o} value={o}>
                {t(`filters.op.${o}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>
          {field()}
          <Button
            variant="contained"
            disabled={draft.value === "" || !draft.metric}
            onClick={() => {
              onFiltersChange([...filters, draft]);
              setDraft({ ...draft, value: "" });
              setAnchor(null);
            }}
          >
            {t("filters.apply")}
          </Button>
        </Stack>
      </Popover>
    </Box>
  );
}

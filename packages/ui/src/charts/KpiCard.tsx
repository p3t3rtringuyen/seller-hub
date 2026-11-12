"use client";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { DeltaBadge } from "../datagrid/DeltaBadge";
import type { CompareValue } from "../datagrid/types";
import { SkeletonMark } from "../datagrid/GridSkeleton";
import { useMessages } from "../messages";

export interface KpiCardProps {
  label: string;
  /** Formatted figure; `null` = no data ("—", e.g. TACoS for a marketplace without ads). */
  value: string | null;
  compare?: CompareValue | null;
  /** Metric definition (from packages/metrics copy) shown as a tooltip on the label. */
  definition?: string;
  loading?: boolean;
  /** Reserves the second line even without compare so the card never changes height. */
  reserveCompareLine?: boolean;
}

/** Fixed height: skeleton and loaded card are the same box (UX-04). */
export function KpiCard({
  label,
  value,
  compare,
  definition,
  loading,
  reserveCompareLine = true,
}: KpiCardProps) {
  const t = useMessages();
  const title = (
    <Typography variant="body2" color="text.secondary" noWrap>
      {label}
    </Typography>
  );
  return (
    <Box
      data-testid="kpi-card"
      data-state={loading ? "loading" : "ready"}
      role="group"
      aria-label={label}
      aria-busy={loading ? true : undefined}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        px: 2,
        py: 1.5,
        minWidth: 160,
        height: 96,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {definition ? <Tooltip title={definition}>{title}</Tooltip> : title}
      <Box sx={{ height: 32, display: "flex", alignItems: "center" }}>
        {loading ? (
          <SkeletonMark shape="number" />
        ) : (
          <Typography
            component="div"
            sx={{
              fontSize: 24,
              fontWeight: 600,
              lineHeight: "32px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value ?? t("kpi.noData")}
          </Typography>
        )}
      </Box>
      <Box sx={{ height: 18, fontSize: 12, color: "text.secondary" }}>
        {loading ? (
          reserveCompareLine ? (
            <SkeletonMark shape="number" />
          ) : null
        ) : compare ? (
          <>
            {t("grid.previousPeriod", { value: compare.previous })}{" "}
            <DeltaBadge
              {...(compare.delta ? { delta: compare.delta } : {})}
              {...(compare.direction ? { direction: compare.direction } : {})}
              {...(compare.good !== undefined ? { good: compare.good } : {})}
            />
          </>
        ) : null}
      </Box>
    </Box>
  );
}

"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMessages } from "../messages";
import { chartColors } from "../tokens";

export interface ChartSeries {
  id: string;
  label: string;
  color?: string;
  /** Format for tooltip and axis (money, percent). */
  format?: (value: number) => string;
}

/** One row per day: `{ date: "2026-11-01", sales: 120, "sales:prev": 100 }`. `null` is a gap, never a zero. */
export type ChartPoint = { date: string } & Record<string, number | string | null>;

export interface TimeSeriesChartProps {
  series: readonly ChartSeries[];
  data: readonly ChartPoint[];
  /** Series ids also drawn as a dashed previous-period line, read from the `<id>:prev` key. */
  compare?: readonly string[];
  loading?: boolean;
  height?: number;
  /** Fixed width for tests / print; default: fills the container. */
  width?: number;
  /** Accessible summary of the chart. */
  label: string;
}

/**
 * Line chart for KPI series with an optional previous-period overlay. Missing days are gaps (UX: not zeros).
 * Loading and empty states keep the same box so the page does not move.
 */
export function TimeSeriesChart({
  series,
  data,
  compare = [],
  loading,
  height = 260,
  width,
  label,
}: TimeSeriesChartProps) {
  const t = useMessages();
  const colorOf = (s: ChartSeries, i: number) =>
    s.color ?? chartColors[i % chartColors.length] ?? "#2f6fdc";
  const body = loading ? (
    <Box
      data-testid="chart-skeleton"
      sx={{ height: "100%", bgcolor: "action.hover", borderRadius: 1 }}
    />
  ) : data.length === 0 ? (
    <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Typography color="text.secondary">{t("chart.noData")}</Typography>
    </Box>
  ) : (
    <ResponsiveContainer width={width ?? "100%"} height="100%">
      <LineChart
        data={data as ChartPoint[]}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        {...(width ? { width, height } : {})}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={24} />
        <YAxis tick={{ fontSize: 12 }} width={56} />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <Line
            key={s.id}
            type="monotone"
            dataKey={s.id}
            name={s.label}
            stroke={colorOf(s, i)}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
        {series
          .filter((s) => compare.includes(s.id))
          .map((s) => {
            const i = series.indexOf(s);
            return (
              <Line
                key={`${s.id}:prev`}
                type="monotone"
                dataKey={`${s.id}:prev`}
                name={t("chart.previous", { series: s.label })}
                stroke={colorOf(s, i)}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
      </LineChart>
    </ResponsiveContainer>
  );
  return (
    <Box
      role="img"
      aria-label={label}
      aria-busy={loading ? true : undefined}
      data-testid="time-series-chart"
      data-state={loading ? "loading" : data.length === 0 ? "empty" : "ready"}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        p: 1,
        boxSizing: "border-box",
        color: "text.secondary",
      }}
      style={{ height }}
    >
      {body}
    </Box>
  );
}

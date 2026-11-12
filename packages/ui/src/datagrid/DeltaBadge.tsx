"use client";
import Box from "@mui/material/Box";
import type { CompareValue } from "./types";

/** Previous-period change. Colour follows `good`, never the sign alone; the arrow and text carry the meaning too. */
export function DeltaBadge({
  delta,
  direction = "flat",
  good,
}: Pick<CompareValue, "delta" | "direction" | "good">) {
  if (!delta) return null;
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "–";
  const color = good === undefined ? "text.secondary" : good ? "success.main" : "error.main";
  return (
    <Box
      component="span"
      data-delta={direction}
      sx={{ color, fontWeight: 600, whiteSpace: "nowrap" }}
    >
      <span aria-hidden="true">{arrow}</span> {delta}
    </Box>
  );
}

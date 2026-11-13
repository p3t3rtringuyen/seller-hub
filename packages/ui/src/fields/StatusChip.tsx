"use client";
import Chip from "@mui/material/Chip";

export type StatusTone = "success" | "warning" | "error" | "info" | "neutral";

/** Default tone per well-known status; unknown statuses are neutral. Text is always shown, never colour alone. */
const toneByStatus: Record<string, StatusTone> = {
  enabled: "success",
  active: "success",
  running: "success",
  delivering: "success",
  paused: "warning",
  scheduled: "info",
  pending: "info",
  archived: "neutral",
  ended: "neutral",
  disabled: "neutral",
  error: "error",
  failed: "error",
  rejected: "error",
  out_of_budget: "error",
};

export function toneFor(status: string): StatusTone {
  return toneByStatus[status.toLowerCase()] ?? "neutral";
}

export interface StatusChipProps {
  status: string;
  /** Display text (from the message catalogue); defaults to the status value. */
  label?: string;
  tone?: StatusTone;
}

export function StatusChip({ status, label, tone }: StatusChipProps) {
  const t = tone ?? toneFor(status);
  return (
    <Chip
      size="small"
      variant={t === "neutral" ? "outlined" : "filled"}
      color={t === "neutral" ? "default" : t}
      label={label ?? status}
      data-status={status}
      data-tone={t}
      sx={{ height: 20, fontSize: 12, maxWidth: "100%", "& .MuiChip-label": { px: 1 } }}
    />
  );
}

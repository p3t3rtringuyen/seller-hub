"use client";
import Box from "@mui/material/Box";
import type { SkeletonShape } from "./types";

// UX-04: a skeleton has the shape and size of what replaces it. Checkbox -> small rounded square, switch -> pill,
// text -> bar, avatar/flag -> disc. Static (no shimmer animation) so measurements and visual tests are stable.

const base = {
  display: "inline-block",
  bgcolor: "action.hover",
  flex: "none",
} as const;

export function SkeletonMark({ shape, lines = 1 }: { shape: SkeletonShape; lines?: number }) {
  switch (shape) {
    case "none":
      return null;
    case "checkbox":
      return (
        <Box
          data-skeleton="checkbox"
          sx={{ ...base, width: 16, height: 16, borderRadius: "3px" }}
        />
      );
    case "switch":
      return (
        <Box data-skeleton="switch" sx={{ ...base, width: 32, height: 18, borderRadius: 999 }} />
      );
    case "disc":
      return (
        <Box data-skeleton="disc" sx={{ ...base, width: 22, height: 22, borderRadius: "50%" }} />
      );
    case "chip":
      return (
        <Box data-skeleton="chip" sx={{ ...base, width: 64, height: 18, borderRadius: 999 }} />
      );
    case "number":
      return (
        <Box
          data-skeleton="number"
          sx={{ ...base, width: "56%", maxWidth: 72, height: 10, borderRadius: "3px" }}
        />
      );
    case "text":
      return lines > 1 ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
          {Array.from({ length: lines }, (_, i) => (
            <Box
              key={i}
              data-skeleton="text"
              sx={{
                ...base,
                height: 10,
                borderRadius: "3px",
                width: i === lines - 1 ? "55%" : "92%",
              }}
            />
          ))}
        </Box>
      ) : (
        <Box data-skeleton="text" sx={{ ...base, width: "72%", height: 10, borderRadius: "3px" }} />
      );
  }
}

"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { InboxIcon } from "../icons";
import { useMessages } from "../messages";

export interface EmptyStateProps {
  /** Specific per screen ("Nothing has been changed in this period.") — UX-20. */
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  const t = useMessages();
  return (
    <Box
      role="status"
      data-testid="empty-state"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        py: 6,
        px: 2,
        textAlign: "center",
      }}
    >
      <Box sx={{ color: "text.secondary" }}>{icon ?? <InboxIcon fontSize="large" />}</Box>
      <Typography variant="h3">{title ?? t("state.emptyTitle")}</Typography>
      {description ? (
        <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Box>
  );
}

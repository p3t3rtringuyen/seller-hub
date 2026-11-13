"use client";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/** Centred card used by every page of the (auth) route group (no app shell, no navigation). */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 440, p: 4 }}>
        <Typography variant="overline" color="text.secondary">
          seller-hub
        </Typography>
        <Typography
          variant="h1"
          component="h1"
          sx={{ fontSize: 24, mb: 0.5 }}
          data-testid="auth-title"
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        ) : null}
        {children}
      </Paper>
    </Box>
  );
}

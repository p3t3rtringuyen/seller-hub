"use client";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useState } from "react";
import { useMessages } from "../messages";

export interface ErrorCardProps {
  title?: string;
  message: string;
  /** HTTP status or problem code, shown with the message and included in the copied content. */
  status?: string | number;
  /** Request id or any extra text a person can send to support. */
  details?: string;
  onRetry?: () => void;
}

/** UX-20: failures render in place, with message and Retry; one failing table must not break its neighbours. */
export function ErrorCard({ title, message, status, details, onRetry }: ErrorCardProps) {
  const t = useMessages();
  const [copied, setCopied] = useState(false);
  const content = [status !== undefined ? `Status: ${status}` : "", message, details ?? ""]
    .filter(Boolean)
    .join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Alert severity="error" data-testid="error-card" role="alert" variant="outlined">
      <AlertTitle>{title ?? t("state.errorTitle")}</AlertTitle>
      {status !== undefined ? <strong>{status} · </strong> : null}
      {message}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        {onRetry ? (
          <Button color="error" variant="outlined" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : null}
        <Button color="inherit" onClick={copy}>
          {copied ? t("state.copied") : t("state.copyError")}
        </Button>
      </Stack>
    </Alert>
  );
}

"use client";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useMessages } from "../messages";

export interface ToastInput {
  tone: "success" | "info" | "warning" | "error";
  message: string;
  /** e.g. a "detail / error file" link for partial results (UX-12). */
  action?: { label: string; onClick: () => void };
  /** Same key replaces the visible toast instead of stacking (use for "toast once", UX-08). */
  key?: string;
  autoHideMs?: number | null;
}
interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  push: (toast: ToastInput) => void;
}
const ToastContext = createContext<ToastApi>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [seq, setSeq] = useState(0);
  const push = useCallback(
    (toast: ToastInput) => {
      setSeq((n) => n + 1);
      setQueue((q) => {
        const id = seq + 1;
        const rest = toast.key ? q.filter((i) => i.key !== toast.key) : q;
        return [...rest, { ...toast, id }];
      });
    },
    [seq],
  );
  const api = useMemo(() => ({ push }), [push]);
  const current = queue[0];
  const close = () => setQueue((q) => q.slice(1));
  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? (
        <Snackbar
          key={current.id}
          open
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          autoHideDuration={
            current.autoHideMs === null
              ? null
              : (current.autoHideMs ?? (current.tone === "error" ? 10000 : 5000))
          }
          onClose={(_, reason) => {
            if (reason !== "clickaway") close();
          }}
        >
          <Alert
            severity={current.tone}
            variant="filled"
            onClose={close}
            action={
              current.action ? (
                <Button color="inherit" size="small" onClick={current.action.onClick}>
                  {current.action.label}
                </Button>
              ) : undefined
            }
          >
            {current.message}
          </Alert>
        </Snackbar>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export interface BulkResult {
  ok: number;
  failed: number;
}

/**
 * UX-12/13: HTTP 200 is not success. Zero successes or any failure is shown as such; partial success is a warning
 * with Successful / Failed counts, never a clean success.
 */
export function useBulkResultToast() {
  const { push } = useToast();
  const t = useMessages();
  return useCallback(
    (result: BulkResult, detail?: { label: string; onClick: () => void }) => {
      const base = { ...(detail ? { action: detail } : {}) };
      if (result.failed === 0 && result.ok > 0) {
        push({ tone: "success", message: t("toast.success", { ok: result.ok }), ...base });
      } else if (result.ok === 0) {
        push({ tone: "error", message: t("toast.failed", { failed: result.failed }), ...base });
      } else {
        push({
          tone: "warning",
          message: t("toast.partial", { ok: result.ok, failed: result.failed }),
          ...base,
        });
      }
    },
    [push, t],
  );
}

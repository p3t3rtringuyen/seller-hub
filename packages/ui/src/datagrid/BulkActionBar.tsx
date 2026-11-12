"use client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { ConfirmDialog } from "../feedback/Dialogs";
import { useMessages } from "../messages";
import { useCan } from "../permissions";

export interface BulkAction {
  id: string;
  label: string;
  /** Present when the action would be a no-op or unsafe: the button disables and the tooltip explains why. */
  disabledReason?: string;
  destructive?: boolean;
  /** Every write shows a confirm dialog ("Confirm Pause 3 Campaigns" + consequence sentence). */
  confirm: { title: string; consequence: string; confirmLabel?: string; irreversible?: boolean };
  run: () => void | Promise<void>;
}

export interface BulkActionBarProps {
  /** Rows selected, across pages. */
  count: number;
  max?: number;
  actions: readonly BulkAction[];
  /** Permission that allows editing; without it the bar does not render at all (UX-12, UX-19). */
  permission?: string;
  /** All buttons disable while a write is in flight. */
  busy?: boolean;
  onClear: () => void;
}

export function BulkActionBar({
  count,
  max,
  actions,
  permission,
  busy,
  onClear,
}: BulkActionBarProps) {
  const t = useMessages();
  const allowed = useCan(permission ?? "");
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [running, setRunning] = useState(false);
  if (count === 0) return null;
  if (permission && !allowed) return null;
  const disabledAll = Boolean(busy) || running;

  return (
    <Box
      role="toolbar"
      aria-label={t("grid.selected", { count })}
      data-part="bulk-bar"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        py: 0.75,
        bgcolor: "action.selected",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography sx={{ fontWeight: 600 }}>
        {t("grid.selected", { count })}
        {max ? ` / ${max}` : ""}
      </Typography>
      {actions.map((a) => {
        const reason = a.disabledReason;
        const button = (
          <Button
            variant="outlined"
            color={a.destructive ? "error" : "primary"}
            disabled={disabledAll || Boolean(reason)}
            onClick={() => setPending(a)}
          >
            {a.label}
          </Button>
        );
        // A disabled button swallows pointer events, so the tooltip hangs on a wrapper.
        return reason ? (
          <Tooltip key={a.id} title={reason}>
            <span>{button}</span>
          </Tooltip>
        ) : (
          <span key={a.id}>{button}</span>
        );
      })}
      <Box sx={{ flex: 1 }} />
      <Button color="inherit" onClick={onClear} disabled={disabledAll}>
        {t("bulk.clear")}
      </Button>
      {pending ? (
        <ConfirmDialog
          open
          title={pending.confirm.title}
          consequence={pending.confirm.consequence}
          confirmLabel={pending.confirm.confirmLabel ?? pending.label}
          irreversible={pending.confirm.irreversible ?? false}
          destructive={pending.destructive ?? false}
          busy={running}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            setRunning(true);
            try {
              await pending.run();
            } finally {
              setRunning(false);
              setPending(null);
            }
          }}
        />
      ) : null}
    </Box>
  );
}

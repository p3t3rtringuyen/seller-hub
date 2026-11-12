"use client";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { CloseIcon } from "../icons";
import { useMessages } from "../messages";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer buttons. */
  actions?: ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg";
}

export function Modal({ open, title, onClose, children, actions, maxWidth = "sm" }: ModalProps) {
  const t = useMessages();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={maxWidth}
      aria-labelledby="modal-title"
    >
      <DialogTitle id="modal-title" sx={{ pr: 6 }}>
        {title}
        <IconButton
          aria-label={t("common.close")}
          onClick={onClose}
          size="small"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      {actions ? <DialogActions>{actions}</DialogActions> : null}
    </Dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  /** "Confirm Pause 3 Campaigns" */
  title: string;
  /** One sentence naming the consequence. */
  consequence: string;
  confirmLabel: string;
  /** Irreversible actions (Archive) say so. */
  irreversible?: boolean;
  destructive?: boolean;
  /** All buttons disable while the write is in flight (UX-12). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirm dialog for bulk and destructive writes (UX-12). */
export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  irreversible,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useMessages();
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
    >
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent id="confirm-body">
        <Typography>{consequence}</Typography>
        {irreversible ? (
          <Typography sx={{ mt: 1, fontWeight: 600 }} color="error">
            {t("bulk.irreversible")}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy} color="inherit">
          {t("common.cancel")}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          variant="contained"
          color={destructive || irreversible ? "error" : "primary"}
          autoFocus
        >
          {busy ? t("bulk.working") : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

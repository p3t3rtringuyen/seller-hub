"use client";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { EditIcon } from "../icons";
import { sanitizeNumeric, type NumericKind } from "../fields/sanitize";
import { useMessages } from "../messages";

export interface InlineEditCellProps {
  /** Current saved value as shown (already formatted). */
  display: string;
  /** Raw value placed in the input when editing starts. */
  value: string;
  kind: "text" | NumericKind;
  /** Resolves when saved; reject (or return a string) to report "Not saved". */
  onSave: (value: string) => Promise<void | string>;
  /** Returns an error message, or null when valid (limits come from marketplace data, never constants). */
  validate?: (value: string) => string | null;
  disabled?: boolean;
  /** Why editing is locked (shown as the tooltip of the display value). */
  disabledReason?: string;
  ariaLabel: string;
  max?: number;
}

/**
 * Inline edit (budget, bid). Enter saves, Escape cancels. On failure the typed value stays in the input and the cell
 * says "Not saved" (UX-13); nothing is written optimistically.
 */
export function InlineEditCell({
  display,
  value,
  kind,
  onSave,
  validate,
  disabled,
  disabledReason,
  ariaLabel,
  max,
}: InlineEditCellProps) {
  const t = useMessages();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => {
    if (disabled) return;
    setDraft(value);
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
  };
  const commit = async () => {
    if (saving) return;
    if (draft === value) return cancel();
    const invalid = validate?.(draft) ?? null;
    if (invalid) return setError(invalid);
    setSaving(true);
    try {
      const outcome = await onSave(draft);
      if (typeof outcome === "string") setError(outcome);
      else setEditing(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("edit.notSaved"));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%" }}
        title={disabled ? disabledReason : undefined}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {display}
        </span>
        {disabled ? null : (
          <IconButton size="small" aria-label={`${t("edit.edit")} ${ariaLabel}`} onClick={start}>
            <EditIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>
    );
  }
  return (
    <Box sx={{ width: "100%" }}>
      <InputBase
        inputRef={inputRef}
        autoFocus
        value={draft}
        disabled={saving}
        error={Boolean(error)}
        inputProps={{
          "aria-label": ariaLabel,
          "aria-invalid": Boolean(error),
          inputMode:
            kind === "integer" || kind === "percent"
              ? "numeric"
              : kind === "text"
                ? "text"
                : "decimal",
        }}
        sx={{
          width: "100%",
          border: 1,
          borderColor: error ? "error.main" : "primary.main",
          borderRadius: 1,
          px: 0.75,
          height: 26,
        }}
        onChange={(e) =>
          setDraft(
            kind === "text"
              ? e.target.value
              : sanitizeNumeric(kind, e.target.value, max !== undefined ? { max } : {}, draft),
          )
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") cancel();
        }}
      />
      {error ? (
        <Typography
          variant="caption"
          color="error"
          role="alert"
          sx={{ display: "block", lineHeight: 1.2 }}
        >
          {error === t("edit.notSaved") ? error : `${t("edit.notSaved")}: ${error}`}
        </Typography>
      ) : null}
    </Box>
  );
}

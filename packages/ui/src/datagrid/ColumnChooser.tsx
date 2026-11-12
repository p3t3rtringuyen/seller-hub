"use client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PinIcon, ViewColumnIcon } from "../icons";
import { useMessages } from "../messages";
import {
  hideAll,
  moveColumn,
  orderedIds,
  pinColumn,
  resetOrder,
  showAll,
  toggleHidden,
  unpinAll,
} from "./columnState";
import type { ColumnState, GridColumn } from "./types";

export interface ColumnChooserProps {
  columns: readonly GridColumn<never>[];
  state: ColumnState;
  onChange: (next: ColumnState) => void;
}

/** Column menu (UX-10): show/hide, Hide all / Show all, reorder (drag or buttons), left/right pin, Unpin all, Reset. */
export function ColumnChooser({ columns, state, onChange }: ColumnChooserProps) {
  const t = useMessages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const dragging = useRef<string | null>(null);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const order = orderedIds(columns, state);

  return (
    <>
      <Button
        startIcon={<ViewColumnIcon fontSize="small" />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        color="inherit"
      >
        {t("grid.columns")}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ width: 340, p: 1 }} role="dialog" aria-label={t("grid.columns")}>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", mb: 1 }}>
            <Button onClick={() => onChange(showAll(columns, state))}>
              {t("grid.columns.showAll")}
            </Button>
            <Button onClick={() => onChange(hideAll(columns, state))}>
              {t("grid.columns.hideAll")}
            </Button>
            <Button onClick={() => onChange(unpinAll(state))}>{t("grid.columns.unpinAll")}</Button>
            <Button onClick={() => onChange(resetOrder(state))}>{t("grid.columns.reset")}</Button>
          </Stack>
          <Box
            component="ul"
            sx={{ listStyle: "none", m: 0, p: 0, maxHeight: 360, overflow: "auto" }}
          >
            {order.map((id, index) => {
              const col = byId.get(id);
              if (!col) return null;
              const hidden = state.hidden.includes(id);
              const side = state.pinned[id];
              return (
                <Box
                  component="li"
                  key={id}
                  data-column-id={id}
                  draggable
                  onDragStart={() => {
                    dragging.current = id;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging.current && dragging.current !== id) {
                      onChange(moveColumn(columns, state, dragging.current, index));
                    }
                    dragging.current = null;
                  }}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 36 }}
                >
                  <Checkbox
                    size="small"
                    checked={!hidden}
                    disabled={col.hideable === false}
                    onChange={() => onChange(toggleHidden(columns, state, id))}
                    inputProps={{ "aria-label": t("grid.columns.toggle", { column: col.header }) }}
                  />
                  <Typography noWrap sx={{ flex: 1 }} title={col.header}>
                    {col.header}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={t("grid.columns.moveUp", { column: col.header })}
                    disabled={index === 0}
                    onClick={() => onChange(moveColumn(columns, state, id, index - 1))}
                  >
                    <ArrowUpIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={t("grid.columns.moveDown", { column: col.header })}
                    disabled={index === order.length - 1}
                    onClick={() => onChange(moveColumn(columns, state, id, index + 1))}
                  >
                    <ArrowDownIcon fontSize="small" />
                  </IconButton>
                  {(["left", "right"] as const).map((s) => (
                    <IconButton
                      key={s}
                      size="small"
                      color={side === s ? "primary" : "default"}
                      aria-pressed={side === s}
                      disabled={col.pinnable === false}
                      aria-label={t(
                        s === "left" ? "grid.columns.pinLeft" : "grid.columns.pinRight",
                        { column: col.header },
                      )}
                      onClick={() => onChange(pinColumn(columns, state, id, s))}
                    >
                      <PinIcon
                        fontSize="small"
                        sx={{ transform: s === "left" ? "rotate(-45deg)" : "rotate(45deg)" }}
                      />
                    </IconButton>
                  ))}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Popover>
    </>
  );
}

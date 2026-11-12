"use client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { CalendarIcon } from "../icons";
import { useMessages, type MessageKey } from "../messages";
import {
  autofillCompareEnd,
  previousPeriod,
  presetRange,
  validateRange,
  type CompareValueRange,
  type PresetId,
  type RangeValue,
} from "./dates";

export interface DateRangeCompareProps {
  value: RangeValue;
  compare: CompareValueRange;
  onChange: (value: RangeValue, compare: CompareValueRange) => void;
  /** Today in the marketplace time zone, from the server (UX-17). */
  today: string;
  /** IANA zone shown as a hint ("Dates use the America/Los_Angeles time zone"). */
  timeZone?: string;
  /** Dashboards drop presets that make no sense (Home: no Life time; Inventory: custom only). */
  presets?: readonly PresetId[];
  lifetimeStart?: string;
  /** Compare can be switched off for pages that have no previous-period data. */
  allowCompare?: boolean;
}

export const defaultPresets: readonly PresetId[] = [
  "today",
  "yesterday",
  "last7",
  "last14",
  "last30",
  "last90",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "thisYear",
  "lifetime",
  "custom",
];

const presetKey = (p: PresetId) => `dates.preset.${p}` as MessageKey;

export function DateRangeCompare({
  value,
  compare,
  onChange,
  today,
  timeZone,
  presets = defaultPresets,
  lifetimeStart,
  allowCompare = true,
}: DateRangeCompareProps) {
  const t = useMessages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<RangeValue>(value);
  const [draftCompare, setDraftCompare] = useState<CompareValueRange>(compare);
  const ctx = { today, ...(lifetimeStart ? { lifetimeStart } : {}) };

  const open = (e: React.MouseEvent<HTMLElement>) => {
    setDraft(value);
    setDraftCompare(compare);
    setAnchor(e.currentTarget);
  };
  const issues = validateRange(draft, draftCompare, ctx);
  const issueFor = (field: string) => issues.find((i) => i.field === field);
  const helper = (field: string) => (issueFor(field) ? t("dates.endBeforeStart") : undefined);

  const pickPreset = (preset: PresetId) => {
    if (preset === "custom") return setDraft({ ...draft, preset });
    const range = presetRange(preset, ctx);
    setDraft({ ...range, preset });
    if (draftCompare.enabled) {
      const prev = previousPeriod(range);
      setDraftCompare({ enabled: true, from: prev.from, to: prev.to });
    }
  };
  const setDates = (patch: Partial<{ from: string; to: string }>) => {
    const next = { ...draft, ...patch, preset: "custom" as const };
    setDraft(next);
  };
  const toggleCompare = (enabled: boolean) => {
    if (!enabled) return setDraftCompare({ enabled: false });
    const prev = previousPeriod(draft);
    setDraftCompare({ enabled: true, from: prev.from, to: prev.to });
  };

  const summary = `${value.from} – ${value.to}`;
  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={<CalendarIcon fontSize="small" />}
        onClick={open}
        aria-haspopup="dialog"
      >
        <span>
          {t(presetKey(value.preset))} · {summary}
          {compare.enabled && compare.from && compare.to
            ? ` ⇄ ${compare.from} – ${compare.to}`
            : ""}
        </span>
      </Button>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <Box
          role="dialog"
          aria-label={t("dates.title")}
          sx={{ display: "flex", width: 560, maxWidth: "95vw" }}
        >
          <MenuList
            sx={{ p: 1, borderRight: 1, borderColor: "divider", width: 170 }}
            aria-label={t("dates.title")}
          >
            {presets.map((p) => (
              <MenuItem key={p} selected={draft.preset === p} onClick={() => pickPreset(p)} dense>
                {t(presetKey(p))}
              </MenuItem>
            ))}
          </MenuList>
          <Stack spacing={1.5} sx={{ p: 2, flex: 1 }}>
            <Stack direction="row" spacing={1}>
              <TextField
                type="date"
                label={t("dates.from")}
                value={draft.from}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
                onChange={(e) => setDates({ from: e.target.value })}
                error={Boolean(issueFor("from"))}
              />
              <TextField
                type="date"
                label={t("dates.to")}
                value={draft.to}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { max: today, min: draft.from },
                }}
                onChange={(e) => setDates({ to: e.target.value })}
                error={Boolean(issueFor("to"))}
                helperText={helper("to")}
              />
            </Stack>
            {allowCompare ? (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={draftCompare.enabled}
                      onChange={(e) => toggleCompare(e.target.checked)}
                    />
                  }
                  label={t("dates.compare")}
                />
                {draftCompare.enabled ? (
                  <Stack direction="row" spacing={1}>
                    <TextField
                      type="date"
                      label={t("dates.compareFrom")}
                      value={draftCompare.from ?? ""}
                      slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
                      onChange={(e) => {
                        const from = e.target.value;
                        // End autofills Start + length of the main range; the user can still change it.
                        setDraftCompare({
                          enabled: true,
                          from,
                          to: from ? autofillCompareEnd(from, draft) : "",
                        });
                      }}
                    />
                    <TextField
                      type="date"
                      label={t("dates.compareTo")}
                      value={draftCompare.to ?? ""}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                          max: today,
                          ...(draftCompare.from ? { min: draftCompare.from } : {}),
                        },
                      }}
                      onChange={(e) => setDraftCompare({ ...draftCompare, to: e.target.value })}
                      error={Boolean(issueFor("compareTo"))}
                      helperText={helper("compareTo")}
                    />
                  </Stack>
                ) : null}
              </>
            ) : null}
            {timeZone ? (
              <Typography variant="caption" color="text.secondary">
                {t("dates.timeZone", { zone: timeZone })}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button color="inherit" onClick={() => setAnchor(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="contained"
                disabled={issues.length > 0}
                onClick={() => {
                  onChange(draft, draftCompare);
                  setAnchor(null);
                }}
              >
                {t("common.apply")}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Popover>
    </>
  );
}

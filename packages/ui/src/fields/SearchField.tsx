"use client";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState } from "react";
import { CloseIcon, SearchIcon } from "../icons";
import { useMessages } from "../messages";

export interface SearchFieldProps {
  value: string;
  /** Called after `debounceMs` of no typing, on Enter, and on clear. */
  onSearch: (value: string) => void;
  placeholder?: string;
  label?: string;
  debounceMs?: number;
  width?: number | string;
}

export function SearchField({
  value,
  onSearch,
  placeholder,
  label,
  debounceMs = 400,
  width = 260,
}: SearchFieldProps) {
  const t = useMessages();
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSent = useRef(value);

  useEffect(() => {
    setDraft(value);
    lastSent.current = value;
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = (next: string) => {
    clearTimeout(timer.current);
    if (next === lastSent.current) return;
    lastSent.current = next;
    onSearch(next);
  };

  return (
    <TextField
      type="search"
      value={draft}
      size="small"
      sx={{ width }}
      label={label}
      placeholder={placeholder ?? t("common.search")}
      onChange={(e) => {
        setDraft(e.target.value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => send(e.target.value), debounceMs);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") send(draft);
      }}
      slotProps={{
        htmlInput: { "aria-label": label ?? t("common.search") },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: draft ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label={t("common.clear")}
                onClick={() => {
                  setDraft("");
                  send("");
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}

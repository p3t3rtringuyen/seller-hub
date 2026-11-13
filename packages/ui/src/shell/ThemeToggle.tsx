"use client";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useColorScheme } from "@mui/material/styles";
import { useMessages } from "../messages";

/** Light / dark / system (persisted by MUI in localStorage; the root layout runs InitColorSchemeScript). */
export function ThemeToggle() {
  const t = useMessages();
  const { mode, setMode } = useColorScheme();
  if (!mode) return null;
  return (
    <TextField
      select
      size="small"
      label={t("shell.theme")}
      value={mode}
      onChange={(e) => setMode(e.target.value as "light" | "dark" | "system")}
      sx={{ minWidth: 110 }}
    >
      <MenuItem value="system">{t("shell.theme.system")}</MenuItem>
      <MenuItem value="light">{t("shell.theme.light")}</MenuItem>
      <MenuItem value="dark">{t("shell.theme.dark")}</MenuItem>
    </TextField>
  );
}

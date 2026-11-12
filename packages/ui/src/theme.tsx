"use client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider as MuiThemeProvider, createTheme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { elevation, fontFamily, palette, radius } from "./tokens";

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data-theme" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: palette.light.primary, contrastText: palette.light.primaryContrast },
        secondary: { main: palette.light.secondary },
        success: { main: palette.light.success },
        warning: { main: palette.light.warning },
        error: { main: palette.light.error },
        info: { main: palette.light.info },
        background: { default: palette.light.background, paper: palette.light.surface },
        text: { primary: palette.light.text, secondary: palette.light.textMuted },
        divider: palette.light.border,
      },
    },
    dark: {
      palette: {
        primary: { main: palette.dark.primary, contrastText: palette.dark.primaryContrast },
        secondary: { main: palette.dark.secondary },
        success: { main: palette.dark.success },
        warning: { main: palette.dark.warning },
        error: { main: palette.dark.error },
        info: { main: palette.dark.info },
        background: { default: palette.dark.background, paper: palette.dark.surface },
        text: { primary: palette.dark.text, secondary: palette.dark.textMuted },
        divider: palette.dark.border,
      },
    },
  },
  shape: { borderRadius: radius.md },
  spacing: 8,
  typography: {
    fontFamily,
    fontSize: 13,
    h1: { fontSize: "1.5rem", fontWeight: 600 },
    h2: { fontSize: "1.25rem", fontWeight: 600 },
    h3: { fontSize: "1.05rem", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true, size: "small" } },
    MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiPopover: { styleOverrides: { paper: { boxShadow: elevation.popover } } },
  },
});

/** Applies the theme (light/dark through `data-theme`) and the CSS baseline. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <MuiThemeProvider theme={theme} defaultMode="system">
      <CssBaseline enableColorScheme />
      {children}
    </MuiThemeProvider>
  );
}

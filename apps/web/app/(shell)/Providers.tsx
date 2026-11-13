"use client";
import { ThemeProvider, ToastProvider, UiMessagesProvider } from "@seller-hub/ui";
import type { ReactNode } from "react";
import { uiMessageOverrides } from "./messages";

/** Theme (light/dark), design-system copy overrides and toasts for the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <UiMessagesProvider messages={uiMessageOverrides}>
        <ToastProvider>{children}</ToastProvider>
      </UiMessagesProvider>
    </ThemeProvider>
  );
}

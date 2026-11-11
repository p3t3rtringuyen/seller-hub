import type { ReactNode } from "react";

// Minimal root layout. P3-DS owns this file from here on (shell, theme, providers).
export const metadata = { title: "seller-hub" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

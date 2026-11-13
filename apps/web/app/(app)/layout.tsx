import type { ReactNode } from "react";
import { AppFrame } from "../(shell)/AppFrame";
import { ShellSessionProvider } from "../(shell)/session";

// Every authenticated page renders inside the app shell (nav + slots from the generated registries). The session
// provider (P3-IDENTITY) loads /v1/me once and sends a signed-out browser to /sign-in.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ShellSessionProvider>
      <AppFrame>{children}</AppFrame>
    </ShellSessionProvider>
  );
}
